import { useState } from 'react'

import { CloseIcon, DeviceIcon, InfoIcon } from './Icons'
import type { PrinterStatus } from '../types'

interface DevicePanelProps {
  status: PrinterStatus | null
  onClose: () => void
  onStatusChange: (status: PrinterStatus) => void
  onNotice: (message: string, tone?: 'success' | 'error') => void
}

async function getErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string }
    return body.message || `请求失败 (${response.status})`
  } catch {
    return `请求失败 (${response.status})`
  }
}

export default function DevicePanel({
  status,
  onClose,
  onStatusChange,
  onNotice,
}: DevicePanelProps) {
  const [host, setHost] = useState(status?.host ?? '')
  const [port, setPort] = useState(String(status?.port || 9100))
  const [isConnecting, setIsConnecting] = useState(false)
  const [isTesting, setIsTesting] = useState(false)

  const handleSave = async () => {
    if (!host.trim()) {
      onNotice('请填写打印机 IP。', 'error')
      return
    }

    setIsConnecting(true)

    try {
      const response = await fetch('/api/printer/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: port.trim() ? Number(port) : 9100,
        }),
      })

      if (!response.ok) {
        throw new Error(await getErrorMessage(response))
      }

      const body = (await response.json()) as {
        reachable: boolean
        message: string
        status: PrinterStatus
      }
      onStatusChange(body.status)
      onNotice(body.message, body.reachable ? 'success' : 'error')
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '打印机连接失败。', 'error')
    } finally {
      setIsConnecting(false)
    }
  }

  const handleTestPrint = async () => {
    setIsTesting(true)

    try {
      const response = await fetch('/api/printer/test', { method: 'POST' })

      if (!response.ok) {
        throw new Error(await getErrorMessage(response))
      }

      const body = (await response.json()) as { status?: PrinterStatus }

      if (body.status) {
        onStatusChange(body.status)
      }

      onNotice('测试页已送到 XP-80U。')
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '测试页打印失败。', 'error')
    } finally {
      setIsTesting(false)
    }
  }

  const reachable = status?.reachable ?? false
  const configured = status?.configured ?? false

  return (
    <div className="device-backdrop" role="presentation" onMouseDown={onClose}>
      <aside
        className="device-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="device-panel-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="device-panel-head">
          <div>
            <span className="eyebrow">打印设备</span>
            <h2 id="device-panel-title">芯烨 XP-80U</h2>
          </div>
          <button className="icon-button" type="button" aria-label="关闭设备设置" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        <div className={`device-state ${reachable ? 'online' : ''}`}>
          <div className="device-illustration">
            <DeviceIcon width={34} height={34} />
          </div>
          <div>
            <strong>{reachable ? '网口已连通' : configured ? '地址已保存' : '尚未配置'}</strong>
            <span>
              {configured ? `${status?.host}:${status?.port}` : '局域网 ESC/POS · 80mm'}
            </span>
          </div>
          <i aria-label={reachable ? '在线' : '离线'} />
        </div>

        <div className="device-form">
          <label>
            <span>打印机 IP</span>
            <input
              value={host}
              autoComplete="off"
              inputMode="decimal"
              placeholder="192.168.1.100"
              spellCheck={false}
              onChange={(event) => setHost(event.target.value)}
            />
          </label>
          <label>
            <span>端口</span>
            <input
              value={port}
              autoComplete="off"
              inputMode="numeric"
              placeholder="9100"
              onChange={(event) => setPort(event.target.value)}
            />
          </label>
          <button
            className="button primary full-width"
            type="button"
            disabled={isConnecting || isTesting}
            onClick={handleSave}
          >
            {isConnecting ? '正在连接…' : '保存并测试连接'}
          </button>
          <button
            className="button quiet full-width"
            type="button"
            disabled={!configured || isConnecting || isTesting}
            onClick={handleTestPrint}
          >
            {isTesting ? '正在打印测试页…' : '打印测试页'}
          </button>
        </div>

        <div className="device-callout">
          <InfoIcon width={18} height={18} />
          <p>
            小票由本机直接发 ESC/POS 到打印机 9100 端口，走 GB18030 汉字模式，一行 48
            个半角字符。地址只留在本次进程里；长期使用可写进 <code>.env.local</code>。
          </p>
        </div>

        <ol className="device-steps">
          <li>
            <span>1</span>
            <p>网线接到 XP-80U，和这台电脑处在同一局域网。</p>
          </li>
          <li>
            <span>2</span>
            <p>按住走纸键开机，自检页上会印出 IP。端口一般是 9100。</p>
          </li>
          <li>
            <span>3</span>
            <p>保存并连通后，用测试页确认汉字和切纸，再批量打印小票。</p>
          </li>
        </ol>
      </aside>
    </div>
  )
}

DevicePanel.displayName = 'DevicePanel'
