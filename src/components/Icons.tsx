import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

const iconProps: IconProps = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
}

export function ReceiptIcon(props: IconProps) {
  return (
    <svg {...iconProps} {...props}>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" />
      <path d="M9 8h6M9 12h6M9 16h3" />
    </svg>
  )
}

export function PrinterIcon(props: IconProps) {
  return (
    <svg {...iconProps} {...props}>
      <path d="M7 8V3h10v5M7 17H5a2 2 0 0 1-2-2v-4a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v4a2 2 0 0 1-2 2h-2" />
      <path d="M7 14h10v7H7z" />
      <path d="M17 11h.01" />
    </svg>
  )
}

export function DeviceIcon(props: IconProps) {
  return (
    <svg {...iconProps} {...props}>
      <rect x="5" y="2.5" width="14" height="19" rx="4" />
      <path d="M8.5 7.5h7M9 12h6M10 16h4" />
    </svg>
  )
}

export function SparkleIcon(props: IconProps) {
  return (
    <svg {...iconProps} {...props}>
      <path d="m12 3 1.1 3.2a7 7 0 0 0 4.4 4.4l3.2 1.1-3.2 1.1a7 7 0 0 0-4.4 4.4L12 20.4l-1.1-3.2a7 7 0 0 0-4.4-4.4l-3.2-1.1 3.2-1.1a7 7 0 0 0 4.4-4.4L12 3Z" />
    </svg>
  )
}

export function CalendarIcon(props: IconProps) {
  return (
    <svg {...iconProps} {...props}>
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M8 3v4M16 3v4M3 10h18" />
    </svg>
  )
}

export function CheckIcon(props: IconProps) {
  return (
    <svg {...iconProps} {...props}>
      <path d="m5 12 4 4L19 6" />
    </svg>
  )
}

export function CloseIcon(props: IconProps) {
  return (
    <svg {...iconProps} {...props}>
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  )
}

export function InfoIcon(props: IconProps) {
  return (
    <svg {...iconProps} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </svg>
  )
}
