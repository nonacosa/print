import express from 'express'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  buildReceipt,
  buildTestPage,
  probePrinter,
  sendToPrinter,
  type EscposLine,
  type EscposReceipt,
} from './escpos.ts'

const localEnvFile = resolve(process.cwd(), '.env.local')

if (existsSync(localEnvFile)) {
  process.loadEnvFile(localEnvFile)
}

interface PrinterConfig {
  host: string
  port: number
}

interface PrintJob extends EscposReceipt {
  receiptId: string
}

interface PrinterStatus {
  configured: boolean
  reachable: boolean
  host: string
  port: number
  model: 'XP-80U'
  paper: '80mm'
}

const app = express()
const port = Number(process.env.PRINTER_API_PORT ?? 8787)

let printerConfig: PrinterConfig = {
  host: process.env.PRINTER_HOST?.trim() ?? '',
  port: readPort(process.env.PRINTER_PORT, 9100),
}

let printQueue: Promise<unknown> = Promise.resolve()

app.use(express.json({ limit: '1mb' }))

function readPort(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').trim())

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return fallback
  }

  return parsed
}

function isPrinterHost(value: string): boolean {
  if (value.length === 0 || value.length > 253) {
    return false
  }

  const ipv4Parts = value.split('.')

  if (ipv4Parts.length === 4) {
    return ipv4Parts.every((part) => {
      if (!/^\d{1,3}$/.test(part) || (part.length > 1 && part.startsWith('0'))) {
        return false
      }

      return Number(part) <= 255
    })
  }

  return /^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])$/.test(
    value,
  )
}

function isConfigured(): boolean {
  return Boolean(printerConfig.host)
}

function formatTimestamp(): string {
  const date = new Date()
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))

  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`
}

function statusPayload(reachable: boolean): PrinterStatus {
  return {
    configured: isConfigured(),
    reachable,
    host: printerConfig.host,
    port: printerConfig.port,
    model: 'XP-80U',
    paper: '80mm',
  }
}

async function probeCurrentPrinter(): Promise<boolean> {
  if (!isConfigured()) {
    return false
  }

  try {
    await probePrinter(printerConfig.host, printerConfig.port)
    return true
  } catch {
    return false
  }
}

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = printQueue.then(task, task)
  printQueue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

function readLine(value: unknown): EscposLine | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const line = value as Record<string, unknown>

  if (typeof line.name !== 'string' || line.name.trim().length === 0 || line.name.length > 40) {
    return null
  }

  if (!Number.isInteger(line.quantity) || (line.quantity as number) < 1 || (line.quantity as number) > 99) {
    return null
  }

  if (
    !Number.isInteger(line.subtotalCents) ||
    (line.subtotalCents as number) < 0 ||
    (line.subtotalCents as number) > 1_000_000
  ) {
    return null
  }

  return {
    name: line.name.trim(),
    quantity: line.quantity as number,
    subtotalCents: line.subtotalCents as number,
  }
}

function readJob(value: unknown): PrintJob | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const job = value as Record<string, unknown>

  if (typeof job.receiptId !== 'string' || job.receiptId.length === 0 || job.receiptId.length > 80) {
    return null
  }

  if (typeof job.shopName !== 'string' || job.shopName.trim().length === 0 || job.shopName.length > 40) {
    return null
  }

  if (typeof job.orderNo !== 'string' || job.orderNo.length === 0 || job.orderNo.length > 32) {
    return null
  }

  if (typeof job.consumedAt !== 'string' || job.consumedAt.length === 0 || job.consumedAt.length > 32) {
    return null
  }

  if (!Number.isInteger(job.totalCents) || (job.totalCents as number) < 0 || (job.totalCents as number) > 1_000_000) {
    return null
  }

  if (!Array.isArray(job.lines) || job.lines.length === 0 || job.lines.length > 20) {
    return null
  }

  const lines: EscposLine[] = []

  for (const line of job.lines) {
    const parsed = readLine(line)

    if (!parsed) {
      return null
    }

    lines.push(parsed)
  }

  return {
    receiptId: job.receiptId,
    shopName: job.shopName.trim(),
    orderNo: job.orderNo,
    consumedAt: job.consumedAt,
    totalCents: job.totalCents as number,
    lines,
  }
}

app.get('/api/health', (_request, response) => {
  response.json({ success: true })
})

app.get('/api/printer/status', async (_request, response) => {
  const reachable = await probeCurrentPrinter()
  response.json(statusPayload(reachable))
})

app.post('/api/printer/config', async (request, response) => {
  const host = typeof request.body.host === 'string' ? request.body.host.trim() : ''
  const portProvided = request.body.port !== undefined && request.body.port !== ''
  const printerPort = readPort(request.body.port, 9100)

  if (!isPrinterHost(host)) {
    response.status(400).json({ message: '请填写打印机的局域网 IP，例如 192.168.1.100。' })
    return
  }

  if (portProvided && readPort(request.body.port, 0) === 0) {
    response.status(400).json({ message: '端口需要在 1 到 65535 之间，芯烨网口一般是 9100。' })
    return
  }

  printerConfig = { host, port: printerPort }

  try {
    await probePrinter(printerConfig.host, printerConfig.port)
    response.json({
      success: true,
      reachable: true,
      message: '已经连上芯烨 XP-80U。',
      status: statusPayload(true),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : '打印机暂时连不上。'
    response.json({
      success: true,
      reachable: false,
      message,
      status: statusPayload(false),
    })
  }
})

app.post('/api/printer/test', async (_request, response) => {
  if (!isConfigured()) {
    response.status(400).json({ message: '请先填写打印机 IP。' })
    return
  }

  try {
    await enqueue(() =>
      sendToPrinter(
        printerConfig.host,
        printerConfig.port,
        buildTestPage(formatTimestamp(), printerConfig.host, printerConfig.port),
      ),
    )
    response.json({ success: true, status: statusPayload(true) })
  } catch (error) {
    const message = error instanceof Error ? error.message : '测试页打印失败。'
    response.status(502).json({ message })
  }
})

app.post('/api/printer/print', async (request, response) => {
  const rawJobs = Array.isArray(request.body.jobs) ? request.body.jobs : []

  if (rawJobs.length === 0 || rawJobs.length > 50) {
    response.status(400).json({ message: '打印任务格式不正确，单次最多打印 50 张。' })
    return
  }

  const jobs: PrintJob[] = []

  for (const rawJob of rawJobs) {
    const job = readJob(rawJob)

    if (!job) {
      response.status(400).json({ message: '打印任务格式不正确，单次最多打印 50 张。' })
      return
    }

    jobs.push(job)
  }

  if (!isConfigured()) {
    response.status(400).json({ message: '打印机尚未配置，请先填写 IP。' })
    return
  }

  try {
    const results = await enqueue(async () => {
      const printed = []
      let failure: string | null = null

      for (const job of jobs) {
        if (failure) {
          printed.push({
            receiptId: job.receiptId,
            success: false,
            message: failure,
          })
          continue
        }

        try {
          await sendToPrinter(printerConfig.host, printerConfig.port, buildReceipt(job))
          printed.push({
            receiptId: job.receiptId,
            success: true,
            message: '已打印',
          })
        } catch (error) {
          failure = error instanceof Error ? error.message : '打印失败'
          printed.push({
            receiptId: job.receiptId,
            success: false,
            message: failure,
          })
        }
      }

      return printed
    })

    response.json({ results })
  } catch (error) {
    const message = error instanceof Error ? error.message : '批量打印失败。'
    response.status(502).json({ message })
  }
})

app.listen(port, '127.0.0.1', () => {
  process.stdout.write(`XP-80U local adapter: http://127.0.0.1:${port}\n`)
})
