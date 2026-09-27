import { CheckIcon } from './Icons'
import { formatMoney } from '../lib/receiptFormat'
import type { Receipt } from '../types'

interface ReceiptCardProps {
  receipt: Receipt
  selected?: boolean
  printable?: boolean
  onToggle?: (receiptId: string) => void
}

export default function ReceiptCard({
  receipt,
  selected = false,
  printable = false,
  onToggle,
}: ReceiptCardProps) {
  return (
    <article
      className={`receipt-ticket${selected ? ' is-selected' : ''}${printable ? ' is-printable' : ''}`}
    >
      {printable ? null : (
        <button
          className="receipt-select"
          type="button"
          aria-pressed={selected}
          aria-label={`${selected ? '取消选择' : '选择'} ${receipt.consumedAt.slice(0, 10)} 小票`}
          onClick={() => onToggle?.(receipt.id)}
        >
          {selected ? <CheckIcon width={15} height={15} /> : null}
        </button>
      )}

      <div className="receipt-brand">{receipt.shopName}</div>
      <div className="receipt-label">个人留存 · 测试小票</div>
      <div className="receipt-rule" />
      <dl className="receipt-meta">
        <div>
          <dt>订单号</dt>
          <dd>{receipt.orderNo}</dd>
        </div>
        <div>
          <dt>时间</dt>
          <dd>{receipt.consumedAt}</dd>
        </div>
      </dl>
      <div className="receipt-rule dotted" />
      <div className="receipt-table-head">
        <span>品名</span>
        <span>数量</span>
        <span>小计</span>
      </div>
      <div className="receipt-lines">
        {receipt.lines.map((line) => (
          <div className="receipt-line" key={line.id}>
            <span>{line.name}</span>
            <span>×{line.quantity}</span>
            <span>{formatMoney(line.subtotalCents)}</span>
          </div>
        ))}
      </div>
      <div className="receipt-rule" />
      <div className="receipt-total">
        <span>合计</span>
        <strong>{formatMoney(receipt.totalCents)}</strong>
      </div>
      <div className="receipt-rule dotted" />
      <p className="receipt-note">
        本纸条仅作个人用餐记录
        <br />
        非发票 · 非报销凭证
      </p>
      <div className="receipt-barcode" aria-hidden="true" />
    </article>
  )
}

ReceiptCard.displayName = 'ReceiptCard'
