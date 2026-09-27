import { useEffect, useMemo, useState } from 'react'

import DevicePanel from './components/DevicePanel'
import {
  CalendarIcon,
  DeviceIcon,
  PrinterIcon,
  ReceiptIcon,
  SparkleIcon,
} from './components/Icons'
import ReceiptCard from './components/ReceiptCard'
import shopsJson from './data/shops.json'
import {
  createRecentDateInput,
  defaultGeneratorSettings,
  generateReceipt,
  parseBatchDates,
} from './lib/orderGenerator'
import { formatMoney } from './lib/receiptFormat'
import type {
  GeneratorSettings,
  PrinterPrintResult,
  PrinterStatus,
  Receipt,
  ShopConfig,
} from './types'

const shops = shopsJson as ShopConfig[]
const receiptStorageKey = 'memobird-receipts:v1'

interface ReceiptState {
  receipts: Receipt[]
  selectedIds: Set<string>
}

interface StoredReceipts {
  version: 1
  receipts: Receipt[]
}

interface NoticeState {
  message: string
  tone: 'success' | 'error'
}

function loadStoredReceipts(): Receipt[] | null {
  try {
    const rawValue = window.localStorage.getItem(receiptStorageKey)

    if (!rawValue) {
      return null
    }

    const stored = JSON.parse(rawValue) as StoredReceipts

    if (stored.version !== 1 || !Array.isArray(stored.receipts)) {
      return null
    }

    return stored.receipts
  } catch {
    return null
  }
}

function createInitialReceiptState(): ReceiptState {
  const storedReceipts = loadStoredReceipts()
  const dates = parseBatchDates(createRecentDateInput(4))
  const receipts =
    storedReceipts?.length
      ? storedReceipts
      : dates.map((date, index) => generateReceipt(date, shops, defaultGeneratorSettings, index))

  return {
    receipts,
    selectedIds: new Set(receipts.map((receipt) => receipt.id)),
  }
}

function createInitialDateInput(): string {
  const storedReceipts = loadStoredReceipts()

  if (storedReceipts?.length) {
    return storedReceipts.map((receipt) => receipt.consumedAt.slice(0, 10)).join('\n')
  }

  return createRecentDateInput(4)
}

async function getErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string }
    return body.message || `请求失败 (${response.status})`
  } catch {
    return `请求失败 (${response.status})`
  }
}

export default function App() {
  const [receiptState, setReceiptState] = useState<ReceiptState>(createInitialReceiptState)
  const [dateInput, setDateInput] = useState(createInitialDateInput)
  const [settings, setSettings] = useState<GeneratorSettings>(defaultGeneratorSettings)
  const [generationNonce, setGenerationNonce] = useState(10)
  const [deviceStatus, setDeviceStatus] = useState<PrinterStatus | null>(null)
  const [isDevicePanelOpen, setIsDevicePanelOpen] = useState(false)
  const [isPrinting, setIsPrinting] = useState(false)
  const [notice, setNotice] = useState<NoticeState | null>(null)

  const selectedReceipts = useMemo(
    () => receiptState.receipts.filter((receipt) => receiptState.selectedIds.has(receipt.id)),
    [receiptState],
  )
  const selectedTotal = useMemo(
    () => selectedReceipts.reduce((total, receipt) => total + receipt.totalCents, 0),
    [selectedReceipts],
  )
  const selectedTimes = useMemo(
    () => selectedReceipts.map((receipt) => receipt.consumedAt.slice(11)).toSorted(),
    [selectedReceipts],
  )

  useEffect(() => {
    const payload: StoredReceipts = {
      version: 1,
      receipts: receiptState.receipts,
    }
    window.localStorage.setItem(receiptStorageKey, JSON.stringify(payload))
  }, [receiptState.receipts])

  useEffect(() => {
    const controller = new AbortController()

    fetch('/api/printer/status', { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((status: PrinterStatus | null) => {
        if (status) {
          setDeviceStatus(status)
        }
      })
      .catch(() => undefined)

    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!notice) {
      return undefined
    }

    const timeoutId = window.setTimeout(() => setNotice(null), 4200)
    return () => window.clearTimeout(timeoutId)
  }, [notice])

  const handleNotice = (message: string, tone: 'success' | 'error' = 'success') => {
    setNotice({ message, tone })
  }

  const handleGenerate = () => {
    const dates = parseBatchDates(dateInput)

    if (dates.length === 0) {
      handleNotice('请至少输入一个有效日期，格式为 YYYY-MM-DD。', 'error')
      return
    }

    if (
      settings.minAmountCents < 1 ||
      settings.maxAmountCents < settings.minAmountCents ||
      settings.maxAmountCents - settings.minAmountCents > 5000
    ) {
      handleNotice('请检查金额区间，最高金额必须大于等于最低金额。', 'error')
      return
    }

    try {
      const nextNonce = generationNonce + 1
      const receipts = dates.map((date, index) =>
        generateReceipt(date, shops, settings, nextNonce + index),
      )
      setGenerationNonce(nextNonce + dates.length)
      setReceiptState({
        receipts,
        selectedIds: new Set(receipts.map((receipt) => receipt.id)),
      })
      handleNotice(`已生成 ${receipts.length} 张精确到秒的小票。`)
    } catch (error) {
      handleNotice(error instanceof Error ? error.message : '小票生成失败。', 'error')
    }
  }

  const handleRegenerateSelected = () => {
    if (selectedReceipts.length === 0) {
      handleNotice('请先选择需要重新生成的小票。', 'error')
      return
    }

    try {
      const nextNonce = generationNonce + 31
      const selectedDates = new Map(
        selectedReceipts.map((receipt, index) => [
          receipt.id,
          generateReceipt(receipt.consumedAt.slice(0, 10), shops, settings, nextNonce + index),
        ]),
      )
      const receipts = receiptState.receipts.map(
        (receipt) => selectedDates.get(receipt.id) ?? receipt,
      )
      const selectedIds = new Set<string>()

      receiptState.receipts.forEach((receipt) => {
        if (receiptState.selectedIds.has(receipt.id)) {
          selectedIds.add((selectedDates.get(receipt.id) ?? receipt).id)
        }
      })
      setGenerationNonce(nextNonce + selectedDates.size)
      setReceiptState({ receipts, selectedIds })
      handleNotice(`已重新排列 ${selectedDates.size} 张小票。`)
    } catch (error) {
      handleNotice(error instanceof Error ? error.message : '重新生成失败。', 'error')
    }
  }

  const handleToggleReceipt = (receiptId: string) => {
    setReceiptState((current) => {
      const selectedIds = new Set(current.selectedIds)

      if (selectedIds.has(receiptId)) {
        selectedIds.delete(receiptId)
      } else {
        selectedIds.add(receiptId)
      }

      return { ...current, selectedIds }
    })
  }

  const handleToggleAll = () => {
    setReceiptState((current) => ({
      ...current,
      selectedIds:
        current.selectedIds.size === current.receipts.length
          ? new Set()
          : new Set(current.receipts.map((receipt) => receipt.id)),
    }))
  }

  const handleSystemPrint = () => {
    if (selectedReceipts.length === 0) {
      handleNotice('请先选择需要打印的小票。', 'error')
      return
    }

    window.print()
  }

  const handlePrinterPrint = async () => {
    if (selectedReceipts.length === 0) {
      handleNotice('请先选择需要打印的小票。', 'error')
      return
    }

    if (!deviceStatus?.configured) {
      setIsDevicePanelOpen(true)
      handleNotice('请先填写芯烨打印机的 IP。', 'error')
      return
    }

    setIsPrinting(true)

    try {
      const response = await fetch('/api/printer/print', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobs: selectedReceipts.map((receipt) => ({
            receiptId: receipt.id,
            shopName: receipt.shopName,
            orderNo: receipt.orderNo,
            consumedAt: receipt.consumedAt,
            totalCents: receipt.totalCents,
            lines: receipt.lines.map((line) => ({
              name: line.name,
              quantity: line.quantity,
              subtotalCents: line.subtotalCents,
            })),
          })),
        }),
      })

      if (!response.ok) {
        throw new Error(await getErrorMessage(response))
      }

      const body = (await response.json()) as { results: PrinterPrintResult[] }
      const successCount = body.results.filter((result) => result.success).length
      const failedCount = body.results.length - successCount

      if (failedCount > 0) {
        handleNotice(`已打印 ${successCount} 张，${failedCount} 张失败。`, 'error')
      } else {
        handleNotice(`已按顺序打出 ${successCount} 张小票。`)
        setDeviceStatus((current) => (current ? { ...current, reachable: true } : current))
      }
    } catch (error) {
      handleNotice(error instanceof Error ? error.message : '打印失败。', 'error')
    } finally {
      setIsPrinting(false)
    }
  }

  const updateAmount = (field: 'minAmountCents' | 'maxAmountCents', value: string) => {
    const amount = Number(value)

    if (!Number.isFinite(amount)) {
      return
    }

    setSettings((current) => ({ ...current, [field]: Math.round(amount * 100) }))
  }

  return (
    <>
      <div className="app-shell">
        <header className="topbar">
          <a className="brand" href="#top" aria-label="饭点小票台首页">
            <span className="brand-mark">
              <ReceiptIcon />
            </span>
            <span>
              <strong>饭点</strong>
              <small>芯烨 XP-80U</small>
            </span>
          </a>

          <div className="top-actions">
            <button className="device-pill" type="button" onClick={() => setIsDevicePanelOpen(true)}>
              <i className={deviceStatus?.reachable ? 'online' : ''} />
              <span>芯烨 XP-80U</span>
              <b>
                {deviceStatus?.reachable ? '已连通' : deviceStatus?.configured ? '未连通' : '待配置'}
              </b>
            </button>
            <button className="button quiet" type="button" onClick={handleSystemPrint}>
              <PrinterIcon />
              系统打印
            </button>
            <button
              className="button primary"
              type="button"
              disabled={isPrinting}
              onClick={handlePrinterPrint}
            >
              <DeviceIcon />
              {isPrinting ? '正在打印…' : '打印小票'}
            </button>
          </div>
        </header>

        <main id="top">
          <section className="hero">
            <div>
              <span className="eyebrow">Dinner log studio</span>
              <h1>
                把每天的晚饭，
                <em>认真留一张纸。</em>
              </h1>
              <p>
                日期批量输入，菜品合理排列，时间自然落在晚餐前后并精确到秒。
              </p>
            </div>
            <div className="hero-stamp" aria-hidden="true">
              <span>PERSONAL</span>
              <strong>晚饭有着落</strong>
              <small>NOT AN INVOICE</small>
            </div>
          </section>

          <section className="summary-grid" aria-label="当前批次概要">
            <div className="summary-card accent">
              <span>本批已选</span>
              <strong>{selectedReceipts.length}</strong>
              <small>张小票 / 共 {receiptState.receipts.length} 张</small>
            </div>
            <div className="summary-card">
              <span>合计金额</span>
              <strong>{formatMoney(selectedTotal)}</strong>
              <small>
                均价{' '}
                {selectedReceipts.length
                  ? formatMoney(Math.round(selectedTotal / selectedReceipts.length))
                  : '¥0.00'}
              </small>
            </div>
            <div className="summary-card">
              <span>晚餐时间</span>
              <strong className="time-summary">
                {selectedTimes.length
                  ? `${selectedTimes.at(0)?.slice(0, 5)}–${selectedTimes.at(-1)?.slice(0, 5)}`
                  : '—'}
              </strong>
              <small>每张记录均保留到秒</small>
            </div>
            <div className="summary-card device-summary">
              <span>打印通道</span>
              <strong>{deviceStatus?.reachable ? 'XP-80U 在线' : '系统打印可用'}</strong>
              <small>
                {deviceStatus?.reachable
                  ? '局域网 9100 已连通'
                  : deviceStatus?.configured
                    ? '打印机 IP 暂时连不上'
                    : '在设备设置里填写打印机 IP'}
              </small>
            </div>
          </section>

          <div className="workspace">
            <aside className="control-card">
              <div className="section-title">
                <span className="section-icon">
                  <CalendarIcon />
                </span>
                <div>
                  <span className="eyebrow">批次设置</span>
                  <h2>这几天吃过饭</h2>
                </div>
              </div>

              <label className="field-label" htmlFor="batch-dates">
                日期列表
                <span>一行一个，也支持逗号分隔</span>
              </label>
              <textarea
                id="batch-dates"
                className="date-input"
                rows={6}
                value={dateInput}
                spellCheck={false}
                placeholder={'2026-08-12\n2026-08-13\n2026-08-14'}
                onChange={(event) => setDateInput(event.target.value)}
              />

              <div className="amount-row">
                <label>
                  <span>最低金额</span>
                  <div className="money-input">
                    <i>¥</i>
                    <input
                      type="number"
                      min="0.5"
                      step="0.5"
                      value={settings.minAmountCents / 100}
                      onChange={(event) => updateAmount('minAmountCents', event.target.value)}
                    />
                  </div>
                </label>
                <span className="amount-arrow">→</span>
                <label>
                  <span>最高金额</span>
                  <div className="money-input">
                    <i>¥</i>
                    <input
                      type="number"
                      min="0.5"
                      step="0.5"
                      value={settings.maxAmountCents / 100}
                      onChange={(event) => updateAmount('maxAmountCents', event.target.value)}
                    />
                  </div>
                </label>
              </div>

              <div className="time-rule">
                <span className="pulse-dot" />
                <div>
                  <strong>自然晚餐时间</strong>
                  <small>18:35:01–20:20:59 · 避开整点整分</small>
                </div>
              </div>

              <div className="shop-config">
                <span>参与随机的店铺</span>
                <div>
                  {shops.map((shop) => (
                    <span key={shop.id}>{shop.name}</span>
                  ))}
                </div>
                <small>菜单来源：src/data/shops.json</small>
              </div>

              <button className="button primary generate-button" type="button" onClick={handleGenerate}>
                <SparkleIcon />
                生成这一批小票
              </button>
            </aside>

            <section className="receipt-section">
              <div className="receipt-section-head">
                <div>
                  <span className="eyebrow">票面预览</span>
                  <h2>准备打印</h2>
                </div>
                <div className="list-actions">
                  <button className="text-button" type="button" onClick={handleToggleAll}>
                    {receiptState.selectedIds.size === receiptState.receipts.length ? '取消全选' : '全部选择'}
                  </button>
                  <button className="button quiet compact" type="button" onClick={handleRegenerateSelected}>
                    <SparkleIcon />
                    重排已选
                  </button>
                </div>
              </div>

              {receiptState.receipts.length > 0 ? (
                <div className="receipt-grid">
                  {receiptState.receipts.map((receipt) => (
                    <ReceiptCard
                      key={receipt.id}
                      receipt={receipt}
                      selected={receiptState.selectedIds.has(receipt.id)}
                      onToggle={handleToggleReceipt}
                    />
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <ReceiptIcon width={36} height={36} />
                  <strong>还没有小票</strong>
                  <span>在左侧输入日期后生成第一批。</span>
                </div>
              )}
            </section>
          </div>
        </main>
      </div>

      <div className="print-layer" aria-hidden="true">
        {selectedReceipts.map((receipt) => (
          <ReceiptCard key={receipt.id} receipt={receipt} printable />
        ))}
      </div>

      {isDevicePanelOpen ? (
        <DevicePanel
          status={deviceStatus}
          onClose={() => setIsDevicePanelOpen(false)}
          onStatusChange={setDeviceStatus}
          onNotice={handleNotice}
        />
      ) : null}

      {notice ? (
        <div className={`notice ${notice.tone}`} role="status">
          {notice.message}
        </div>
      ) : null}
    </>
  )
}

App.displayName = 'App'
