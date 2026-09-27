import iconv from 'iconv-lite'
import net from 'node:net'

/** 芯烨 80mm、Font A 默认 48 列；汉字占 2 列。 */
export const paperColumns = 48

const ESC = 0x1b
const GS = 0x1d
const FS = 0x1c
const LF = 0x0a

export interface EscposLine {
  name: string
  quantity: number
  subtotalCents: number
}

export interface EscposReceipt {
  shopName: string
  orderNo: string
  consumedAt: string
  lines: EscposLine[]
  totalCents: number
}

function textWidth(value: string): number {
  let width = 0

  for (const character of value) {
    width += (character.codePointAt(0) ?? 0) > 0x7f ? 2 : 1
  }

  return width
}

function truncateToWidth(value: string, maxWidth: number): string {
  let result = ''
  let width = 0

  for (const character of value) {
    const characterWidth = (character.codePointAt(0) ?? 0) > 0x7f ? 2 : 1

    if (width + characterWidth > maxWidth) {
      break
    }

    result += character
    width += characterWidth
  }

  return result
}

function alignSides(leftValue: string, rightValue: string): string {
  const right = truncateToWidth(rightValue, paperColumns)
  const rightWidth = textWidth(right)
  const left = truncateToWidth(leftValue, Math.max(0, paperColumns - rightWidth - 1))
  const gap = Math.max(1, paperColumns - textWidth(left) - rightWidth)
  return `${left}${' '.repeat(gap)}${right}`
}

function money(cents: number): string {
  // U+FFE5 在 GBK 里是双字节全角 ￥。半角 ¥ 会落成 GB18030 四字节，汉字模式对不齐。
  return `￥${(cents / 100).toFixed(2)}`
}

function encode(text: string): Buffer {
  return iconv.encode(text, 'gb18030')
}

function command(...bytes: number[]): Buffer {
  return Buffer.from(bytes)
}

function line(text: string): Buffer {
  return Buffer.concat([encode(text), command(LF)])
}

/**
 * ESC @ 会清掉汉字模式，所以 FS & 必须放在初始化之后。
 * 芯烨国行字库按 GB18030 解释双字节。
 */
function beginDocument(): Buffer[] {
  return [
    command(ESC, 0x40),
    command(FS, 0x26),
    command(ESC, 0x4d, 0x00),
    command(ESC, 0x32),
  ]
}

function endDocument(): Buffer[] {
  return [
    command(ESC, 0x64, 0x04),
    command(GS, 0x56, 0x01),
  ]
}

export function buildReceipt(receipt: EscposReceipt): Buffer {
  const divider = '-'.repeat(paperColumns)
  const itemLines = receipt.lines.map((item) =>
    alignSides(`${item.name} x${item.quantity}`, money(item.subtotalCents)),
  )

  return Buffer.concat([
    ...beginDocument(),
    command(ESC, 0x61, 0x01),
    command(GS, 0x21, 0x11),
    line(truncateToWidth(receipt.shopName, paperColumns / 2)),
    command(GS, 0x21, 0x00),
    line('个人留存 · 测试小票'),
    command(ESC, 0x61, 0x00),
    line(divider),
    line(`订单号: ${receipt.orderNo}`),
    line(`时间: ${receipt.consumedAt}`),
    line(divider),
    line(alignSides('品名 / 数量', '小计')),
    ...itemLines.map((item) => line(item)),
    line(divider),
    command(ESC, 0x45, 0x01),
    line(alignSides('合计', money(receipt.totalCents))),
    command(ESC, 0x45, 0x00),
    line(divider),
    command(ESC, 0x61, 0x01),
    line('本纸条仅作个人用餐记录'),
    line('非发票 · 非报销凭证'),
    command(ESC, 0x61, 0x00),
    ...endDocument(),
  ])
}

export function buildTestPage(printedAt: string, host: string, port: number): Buffer {
  return Buffer.concat([
    ...beginDocument(),
    command(ESC, 0x61, 0x01),
    command(GS, 0x21, 0x11),
    line('芯烨 XP-80U'),
    command(GS, 0x21, 0x00),
    line('ESC/POS 测试页'),
    command(ESC, 0x61, 0x00),
    line('-'.repeat(paperColumns)),
    line('纸宽 80mm · Font A 48 列'),
    line(`地址: ${host}:${port}`),
    line(`时间: ${printedAt}`),
    line('-'.repeat(paperColumns)),
    command(ESC, 0x61, 0x01),
    line('连接正常，可以打印小票'),
    command(ESC, 0x61, 0x00),
    ...endDocument(),
  ])
}

function describeSocketError(error: NodeJS.ErrnoException): Error {
  switch (error.code) {
    case 'ECONNREFUSED':
      return new Error('打印机拒绝连接。请确认网口已启用，端口是 9100。')
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
    case 'EHOSTDOWN':
      return new Error('网络到不了这台打印机。请检查网线和 IP。')
    case 'ETIMEDOUT':
      return new Error('连接打印机超时。')
    case 'ENOTFOUND':
      return new Error('找不到这台打印机的地址。')
    default:
      return new Error(error.message || '连接打印机失败。')
  }
}

export function probePrinter(host: string, port: number, timeoutMs = 1500): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port })
    let settled = false

    const finish = (error?: Error) => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timer)
      socket.destroy()

      if (error) {
        reject(error)
      } else {
        resolve()
      }
    }

    const timer = setTimeout(() => finish(new Error('连接打印机超时。')), timeoutMs)

    socket.once('connect', () => finish())
    socket.once('error', (error: NodeJS.ErrnoException) => finish(describeSocketError(error)))
  })
}

/**
 * 9100 端口打印完通常不主动断开，写完缓冲区就结束，不等对端 FIN。
 */
export function sendToPrinter(host: string, port: number, payload: Buffer, timeoutMs = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port })
    let settled = false

    const finish = (error?: Error) => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timer)
      socket.destroy()

      if (error) {
        reject(error)
      } else {
        resolve()
      }
    }

    const timer = setTimeout(() => finish(new Error('打印机没有在时限内收下数据。')), timeoutMs)

    socket.setNoDelay(true)
    socket.once('error', (error: NodeJS.ErrnoException) => finish(describeSocketError(error)))
    socket.once('connect', () => {
      socket.write(payload, (error) => {
        if (error) {
          finish(error)
          return
        }

        socket.end()
        setTimeout(() => finish(), 200)
      })
    })
  })
}
