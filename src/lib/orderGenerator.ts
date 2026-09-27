import type {
  GeneratorSettings,
  MenuItemConfig,
  Receipt,
  ReceiptLine,
  ShopConfig,
} from '../types'

interface CandidateOrder {
  lines: ReceiptLine[]
  totalCents: number
}

export const defaultGeneratorSettings: GeneratorSettings = {
  minAmountCents: 3000,
  maxAmountCents: 3400,
  dinnerStartSeconds: 18 * 60 * 60 + 35 * 60 + 1,
  dinnerModeSeconds: 19 * 60 * 60 + 18 * 60 + 37,
  dinnerEndSeconds: 20 * 60 * 60 + 20 * 60 + 59,
}

function hashSeed(value: string): number {
  let hash = 2166136261

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return hash >>> 0
}

function createRandom(seed: number): () => number {
  let state = seed

  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function createLine(item: MenuItemConfig, quantity: number): ReceiptLine {
  return {
    id: item.id,
    name: item.name,
    unitPriceCents: item.priceCents,
    quantity,
    subtotalCents: item.priceCents * quantity,
  }
}

function enumerateCandidates(
  shop: ShopConfig,
  settings: GeneratorSettings,
): CandidateOrder[] {
  const mainItems = shop.items.filter((item) => item.category === 'main')
  const extraItems = shop.items.filter((item) => item.category !== 'main')
  const candidates: CandidateOrder[] = []

  function collectExtras(
    main: MenuItemConfig,
    itemIndex: number,
    extraLines: ReceiptLine[],
    extraTotal: number,
  ): void {
    const currentTotal = main.priceCents + extraTotal

    if (currentTotal > settings.maxAmountCents) {
      return
    }

    if (itemIndex === extraItems.length) {
      const itemCount = extraLines.reduce((total, line) => total + line.quantity, 1)
      const drinkCount = extraLines.reduce((total, line) => {
        const item = extraItems.find((extra) => extra.id === line.id)
        return total + (item?.category === 'drink' ? line.quantity : 0)
      }, 0)

      if (
        currentTotal >= settings.minAmountCents &&
        itemCount <= 7 &&
        extraLines.length <= 5 &&
        drinkCount <= 1
      ) {
        candidates.push({
          lines: [createLine(main, 1), ...extraLines],
          totalCents: currentTotal,
        })
      }

      return
    }

    const item = extraItems[itemIndex]

    for (let quantity = 0; quantity <= item.maxQuantity; quantity += 1) {
      const nextLines = quantity > 0 ? [...extraLines, createLine(item, quantity)] : extraLines
      collectExtras(
        main,
        itemIndex + 1,
        nextLines,
        extraTotal + item.priceCents * quantity,
      )
    }
  }

  mainItems.forEach((main) => collectExtras(main, 0, [], 0))
  return candidates
}

function pickCandidate(
  candidates: CandidateOrder[],
  settings: GeneratorSettings,
  random: () => number,
): CandidateOrder {
  if (candidates.length === 0) {
    throw new Error('当前店铺菜单无法组合出目标金额，请调整菜品价格或金额区间。')
  }

  const target = Math.round(
    settings.minAmountCents + random() * (settings.maxAmountCents - settings.minAmountCents),
  )
  const ranked = candidates.toSorted((left, right) => {
    const leftPenalty = Math.abs(left.totalCents - target) + Math.abs(left.lines.length - 4) * 18
    const rightPenalty = Math.abs(right.totalCents - target) + Math.abs(right.lines.length - 4) * 18
    return leftPenalty - rightPenalty
  })
  const choicePool = ranked.slice(0, Math.min(12, ranked.length))

  return choicePool[Math.floor(random() * choicePool.length)]
}

function pickNaturalDinnerSecond(
  settings: GeneratorSettings,
  random: () => number,
): number {
  const { dinnerStartSeconds: start, dinnerModeSeconds: mode, dinnerEndSeconds: end } = settings
  const split = (mode - start) / (end - start)
  const sample = random()
  let secondOfDay: number

  if (sample < split) {
    secondOfDay = start + Math.sqrt(sample * (end - start) * (mode - start))
  } else {
    secondOfDay = end - Math.sqrt((1 - sample) * (end - start) * (end - mode))
  }

  let rounded = Math.round(secondOfDay)

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const minute = Math.floor(rounded / 60) % 60
    const second = rounded % 60
    const looksMechanical = minute % 5 === 0 || second === 0 || second % 10 === 0

    if (!looksMechanical) {
      return rounded
    }

    rounded += 1 + Math.floor(random() * 47)
    rounded = Math.min(Math.max(rounded, start), end)
  }

  return rounded
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function buildConsumedAt(
  date: string,
  settings: GeneratorSettings,
  random: () => number,
): string {
  const secondOfDay = pickNaturalDinnerSecond(settings, random)
  const hour = Math.floor(secondOfDay / 3600)
  const minute = Math.floor((secondOfDay % 3600) / 60)
  const second = secondOfDay % 60

  return `${date} ${pad(hour)}:${pad(minute)}:${pad(second)}`
}

export function generateReceipt(
  date: string,
  shops: ShopConfig[],
  settings: GeneratorSettings,
  nonce = 0,
): Receipt {
  if (shops.length === 0) {
    throw new Error('至少需要配置一家店铺。')
  }

  const random = createRandom(hashSeed(`${date}:${nonce}`))
  const candidateShops = shops
    .map((shop) => ({ shop, candidates: enumerateCandidates(shop, settings) }))
    .filter(({ candidates }) => candidates.length > 0)

  if (candidateShops.length === 0) {
    throw new Error('没有店铺能在当前金额区间内生成合理订单。')
  }

  const selectedShop = candidateShops[Math.floor(random() * candidateShops.length)]
  const selectedOrder = pickCandidate(selectedShop.candidates, settings, random)
  const consumedAt = buildConsumedAt(date, settings, random)
  const timeCode = consumedAt.slice(11).replaceAll(':', '')
  const randomCode = Math.floor(1000 + random() * 9000)
  const orderNo = `${date.replaceAll('-', '')}${timeCode}${randomCode}`

  return {
    id: `${orderNo}-${selectedShop.shop.id}`,
    orderNo,
    shopId: selectedShop.shop.id,
    shopName: selectedShop.shop.name,
    address: selectedShop.shop.address,
    phone: selectedShop.shop.phone,
    consumedAt,
    lines: selectedOrder.lines,
    totalCents: selectedOrder.totalCents,
  }
}

export function parseBatchDates(input: string): string[] {
  const datePattern = /^\d{4}-\d{2}-\d{2}$/
  const uniqueDates = new Set(
    input
      .split(/[\s,，;；]+/)
      .map((value) => value.trim())
      .filter(Boolean)
      .filter((value) => {
        if (!datePattern.test(value)) {
          return false
        }

        const [year, month, day] = value.split('-').map(Number)
        const parsed = new Date(year, month - 1, day)
        return (
          parsed.getFullYear() === year &&
          parsed.getMonth() === month - 1 &&
          parsed.getDate() === day
        )
      }),
  )

  return [...uniqueDates].toSorted()
}

export function createRecentDateInput(days: number): string {
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const dates: string[] = []

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date()
    date.setDate(date.getDate() - offset)
    dates.push(formatter.format(date))
  }

  return dates.join('\n')
}
