export type MenuCategory = 'main' | 'side' | 'addon' | 'drink'

export interface MenuItemConfig {
  id: string
  name: string
  priceCents: number
  category: MenuCategory
  maxQuantity: number
}

export interface ShopConfig {
  id: string
  name: string
  address: string
  phone: string
  items: MenuItemConfig[]
}

export interface ReceiptLine {
  id: string
  name: string
  unitPriceCents: number
  quantity: number
  subtotalCents: number
}

export interface Receipt {
  id: string
  orderNo: string
  shopId: string
  shopName: string
  address: string
  phone: string
  consumedAt: string
  lines: ReceiptLine[]
  totalCents: number
}

export interface GeneratorSettings {
  minAmountCents: number
  maxAmountCents: number
  dinnerStartSeconds: number
  dinnerModeSeconds: number
  dinnerEndSeconds: number
}

export interface PrinterStatus {
  configured: boolean
  reachable: boolean
  host: string
  port: number
  model: string
  paper: string
}

export interface PrinterPrintResult {
  receiptId: string
  success: boolean
  message: string
}
