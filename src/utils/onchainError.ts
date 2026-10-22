/**
 * ABI-aware contract error decoder for Spray.
 *
 * Priority order:
 *  1. Viem decodeErrorResult against the Spray ABI (catches all custom errors)
 *  2. String-matching on the message as a fallback for wallet/RPC errors
 *
 * TooEarly uses the chain's latest block timestamp (fetched once, cached per
 * session) rather than the browser clock, so clock skew never gives a false
 * "unlocked" message.
 */
import { decodeErrorResult } from 'viem'
import { SPRAY_CONTRACT } from '../contract'
import { arcPublicClient } from './publicClient'

// ── Chain timestamp cache ─────────────────────────────────────────────────────
let cachedBlockTs: number | null = null
let blockTsFetchedAt = 0

/** Returns the latest block timestamp (seconds). Cached for 10 s. */
export async function getChainTimestamp(): Promise<number> {
  const now = Date.now()
  if (cachedBlockTs !== null && now - blockTsFetchedAt < 10_000) return cachedBlockTs
  try {
    const block = await arcPublicClient.getBlock({ blockTag: 'latest' })
    cachedBlockTs = Number(block.timestamp)
    blockTsFetchedAt = now
    return cachedBlockTs
  } catch {
    // fall back to browser clock if RPC unreachable
    return Math.floor(now / 1000)
  }
}

// ── Human-readable messages for every Spray custom error ────────────────────
const CUSTOM_ERROR_MESSAGES: Record<string, string> = {
  ZeroAddress:                   'Invalid address — zero address not allowed.',
  InvalidName:                   'Event name is invalid (empty or over 64 characters).',
  InvalidDisplayName:            'Display name is invalid (empty or over 32 characters).',
  InvalidRecipients:             'Recipients are invalid (empty, duplicates, or zero address).',
  InvalidShares:                 'Shares must sum to exactly 100%.',
  InvalidMode:                   'Invalid event mode.',
  InvalidUnlockAt:               'Unlock time must be in the future and within 90 days.',
  InvalidRate:                   'Naira rate must be between 100 and 10,000.',
  AmountOutOfRange:              'Amount must be between 0.10 and 20 USDC.',
  EventCapExceeded:              'This event has reached its 200 USDC cap.',
  EventNotFound:                 'Event not found — check the event ID.',
  NotOpen:                       'This event is no longer accepting sprays.',
  NotHost:                       'Only the event host can do this.',
  NotPOT:                        'This action is only available for Pot events.',
  NotLIVE:                       'This action is only available for Live events.',
  TooEarly:                      'Not unlocked yet — try again in a few seconds.',
  TooLate:                       'The unlock window has passed.',
  AlreadySettled:                'This Pot has already been settled.',
  NothingToRefund:               'No contribution found to refund for your wallet.',
  NothingToWithdraw:             'Nothing to withdraw — your balance is zero.',
  NotCancelled:                  'Refunds are only available after the host cancels the Pot.',
  ReentrancyGuardReentrantCall:  'Transaction blocked — reentrancy detected.',
  SafeERC20FailedOperation:      'USDC transfer failed — check your balance and approval.',
}

/** True when the error data looks like a 4-byte selector + optional args */
function looksLikeRevertData(hex: string): boolean {
  return /^0x[0-9a-f]{8}/i.test(hex)
}

/**
 * Decode a viem/wagmi error into a human-readable string.
 * Never surfaces raw RPC URLs, request bodies, or internal stack traces.
 */
export function parseOnchainError(e: unknown): string {
  // ── 1. Try ABI decode on every plausible error-data field ──────────────────
  const candidates: unknown[] = [e]
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>
    candidates.push(o['cause'], o['data'], o['error'])
    if (o['cause'] && typeof o['cause'] === 'object') {
      const c = o['cause'] as Record<string, unknown>
      candidates.push(c['data'], c['error'])
    }
  }

  for (const c of candidates) {
    const data = (c as { data?: string })?.data ?? (typeof c === 'string' ? c : undefined)
    if (data && looksLikeRevertData(data)) {
      try {
        const decoded = decodeErrorResult({
          abi: SPRAY_CONTRACT.abi,
          data: data as `0x${string}`,
        })
        const msg = CUSTOM_ERROR_MESSAGES[decoded.errorName]
        if (msg) return msg
        return `Contract error: ${decoded.errorName}`
      } catch {
        // not a Spray custom error — fall through
      }
    }
  }

  // ── 2. String matching for wallet / network errors ─────────────────────────
  const raw = [e, (e as { cause?: unknown })?.cause]
    .map(x => [
      (x as { message?: string })?.message ?? '',
      (x as { shortMessage?: string })?.shortMessage ?? '',
    ].join(' '))
    .join(' ')
    .toLowerCase()

  if (raw.includes('user rejected') || raw.includes('user denied') || raw.includes('rejected')) {
    return 'Transaction cancelled.'
  }
  if (raw.includes('insufficient funds') || raw.includes('exceeds balance')) {
    return 'Insufficient USDC balance.'
  }
  if (raw.includes('nonce') || raw.includes('replacement transaction')) {
    return 'Nonce conflict — try refreshing and retrying.'
  }
  if (raw.includes('network') || raw.includes('timeout') || raw.includes('fetch')) {
    return 'Network error. Please try again.'
  }
  if (raw.includes('already known') || raw.includes('already submitted')) {
    return 'This transaction was already submitted.'
  }
  if (raw.includes('gas') && raw.includes('price')) {
    return 'Gas price too low. Try again in a moment.'
  }

  return 'Something went wrong — please try again.'
}

/**
 * Check whether the given address already has a pending transaction in the
 * mempool on Arc. Returns true when wagmi reports a pending hash that has not
 * yet been included in a block.
 */
export function isPendingTx(pendingHash: `0x${string}` | undefined): boolean {
  return !!pendingHash
}
