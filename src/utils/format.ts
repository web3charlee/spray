import { USDC_DECIMALS } from '../contract'

export function formatUsdc(raw: bigint, decimals = 2): string {
  const n = Number(raw) / 10 ** USDC_DECIMALS
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

export function parseUsdc(amount: number): bigint {
  return BigInt(Math.round(amount * 10 ** USDC_DECIMALS))
}

export function formatNgn(usdcRaw: bigint, ngnPerUsd: bigint): string {
  const usdc = Number(usdcRaw) / 10 ** USDC_DECIMALS
  const ngn = usdc * Number(ngnPerUsd)
  return ngn.toLocaleString('en-NG', {
    maximumFractionDigits: 0,
  })
}

export function usdcToNgn(usdcAmount: number, ngnPerUsd: number): number {
  return usdcAmount * ngnPerUsd
}

export function ngnToUsdc(ngnAmount: number, ngnPerUsd: number): number {
  if (ngnPerUsd === 0) return 0
  return ngnAmount / ngnPerUsd
}

export function formatAddress(addr: string): string {
  if (addr.length < 10) return addr
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

export function formatCountdown(targetTs: number): string {
  const now = Date.now() / 1000
  const diff = targetTs - now
  if (diff <= 0) return 'Unlocked'

  const days = Math.floor(diff / 86400)
  const hours = Math.floor((diff % 86400) / 3600)
  const minutes = Math.floor((diff % 3600) / 60)
  const seconds = Math.floor(diff % 60)

  if (days > 0) return `${days}d ${hours}h ${minutes}m`
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
  return `${minutes}m ${seconds}s`
}

export function encodeEventLink(eventId: number, type: 'guest' | 'wall'): string {
  if (type === 'guest') return `/e/${eventId}`
  return `/wall/${eventId}`
}
