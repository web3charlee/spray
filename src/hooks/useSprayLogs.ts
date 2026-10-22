/**
 * useSprayLogs — robust log fetching for a Spray event.
 *
 * Design decisions:
 *  - Returns raw `entries` only. Derived values (senderCount, leaderboard)
 *    are computed by the caller AFTER applying hide/filter logic, so all
 *    derived counts are always consistent with what the UI shows.
 *  - `startBlock` is captured once per eventId via a ref — a bigint identity
 *    change (useMemo re-run) does NOT restart the effect or clear history.
 *  - localStorage cache keyed by eventId: persists entries + lastScannedBlock
 *    so reloads only fetch new blocks. Cache is NEVER cleared on status change.
 *  - Sequential 2 000-block chunks, ~350 ms between requests.
 *  - Exponential backoff up to 6 retries on 429 / rate-limit errors.
 *  - Automatic chunk-size halving on "requested range too large" errors.
 *  - 3-second incremental poll + watchEvent for instant delivery.
 *  - `logError` never contains raw RPC URLs or request bodies.
 *  - `retryBackfill` exposed for a Retry button.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { parseAbiItem, type Log } from 'viem'
import { arcPublicClient } from '../utils/publicClient'
import {
  SPRAY_ADDRESS,
  SPRAY_DEPLOY_BLOCK,
  LOG_CHUNK_SIZE,
} from '../contract'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SprayEntry {
  from: string
  displayName: string
  amount: bigint
  timestamp: number
  /** txHash-logIndex — stable dedup key */
  key: string
}

export interface UseSprayLogsResult {
  /** All fetched entries, newest-first, up to 200 */
  entries: SprayEntry[]
  isLoadingHistory: boolean
  /** Clean error string — never contains raw RPC URLs or request bodies */
  logError: string
  /** Call to restart a failed backfill */
  retryBackfill: () => void
}

// ── ABI ───────────────────────────────────────────────────────────────────────

const SPRAYED_ABI = parseAbiItem(
  'event Sprayed(uint256 indexed eventId, address indexed from, string displayName, uint256 amount, uint256 timestamp)'
)

// ── localStorage helpers ──────────────────────────────────────────────────────

interface CacheEntry {
  entries: (Omit<SprayEntry, 'amount'> & { amount: string })[]
  lastScannedBlock: string
}

function cacheKey(eventId: number) { return `spray_logs_${eventId}` }

function loadCache(eventId: number): { entries: SprayEntry[]; lastScannedBlock: bigint } | null {
  try {
    const raw = localStorage.getItem(cacheKey(eventId))
    if (!raw) return null
    const c = JSON.parse(raw) as CacheEntry
    return {
      entries: c.entries.map(e => ({ ...e, amount: BigInt(e.amount) })),
      lastScannedBlock: BigInt(c.lastScannedBlock),
    }
  } catch {
    return null
  }
}

function saveCache(eventId: number, entries: SprayEntry[], lastScannedBlock: bigint) {
  try {
    const c: CacheEntry = {
      entries: entries.map(e => ({ ...e, amount: e.amount.toString() })),
      lastScannedBlock: lastScannedBlock.toString(),
    }
    localStorage.setItem(cacheKey(eventId), JSON.stringify(c))
  } catch {
    // localStorage quota — silently skip
  }
}

// ── Key / entry helpers ───────────────────────────────────────────────────────

function buildKey(log: Log): string {
  const tx = (log as unknown as { transactionHash?: string }).transactionHash ?? 'unknown'
  const idx = (log as unknown as { logIndex?: number }).logIndex ?? 0
  return `${tx}-${idx}`
}

function toEntry(log: Log, filterEventId: number): SprayEntry | null {
  const args = (log as unknown as {
    args?: { eventId?: bigint; from?: string; displayName?: string; amount?: bigint; timestamp?: bigint }
  }).args ?? {}
  const { eventId: logEventId, from, displayName, amount, timestamp } = args
  if (logEventId === undefined || Number(logEventId) !== filterEventId) return null
  if (!from || !displayName || amount === undefined || !timestamp) return null
  return { from, displayName, amount, timestamp: Number(timestamp), key: buildKey(log) }
}

// ── Backoff helpers ───────────────────────────────────────────────────────────

const DELAY_MS = 350
const MAX_RETRIES = 6

function sleep(ms: number) { return new Promise<void>(r => setTimeout(r, ms)) }

function isRateLimitError(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message ?? '').toLowerCase()
  const code = (err as { code?: number })?.code
  return code === 429 || msg.includes('429') || msg.includes('rate limit') ||
         msg.includes('too many requests') || msg.includes('rate-limit')
}

function isRangeLimitError(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message ?? '').toLowerCase()
  const code = (err as { code?: number })?.code
  return code === -32012 || msg.includes('range too large') || msg.includes('-32012') ||
         msg.includes('block range') || msg.includes('exceeds maximum block range')
}

function cleanFetchError(err: unknown): string {
  if (isRateLimitError(err)) return 'RPC rate limit reached. Retrying…'
  if (isRangeLimitError(err)) return 'Chunk too large — reducing and retrying…'
  const msg = (err as { shortMessage?: string })?.shortMessage ??
              (err as { message?: string })?.message ?? ''
  const cleaned = msg.replace(/https?:\/\/\S+/g, '[rpc]').replace(/\{.*?\}/gs, '[…]')
  return cleaned.length > 120 ? cleaned.slice(0, 120) + '…' : cleaned
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useSprayLogs(
  eventId: number | undefined,
  /**
   * Optional hint from ?b= — start scanning from this block for NEW events.
   * Captured once per eventId via a ref; bigint identity changes don't
   * restart the effect or clear history.
   */
  startBlock?: bigint,
): UseSprayLogsResult {
  const [entries, setEntries] = useState<SprayEntry[]>([])
  const [isLoadingHistory, setIsLoadingHistory] = useState(false)
  const [logError, setLogError] = useState('')
  const [backfillTrigger, setBackfillTrigger] = useState(0)

  // Refs — only read from effects/callbacks, never during render
  const seenKeys          = useRef(new Set<string>())
  const lastScannedBlock  = useRef<bigint>(SPRAY_DEPLOY_BLOCK - 1n)
  const pollTimer         = useRef<ReturnType<typeof setInterval> | null>(null)
  const unwatchRef        = useRef<(() => void) | null>(null)
  const eventIdRef        = useRef<number | undefined>(undefined)
  const currentChunkSize  = useRef<bigint>(LOG_CHUNK_SIZE)
  // Capture startBlock once per eventId — prevents bigint identity churn
  const startBlockRef     = useRef<bigint | undefined>(undefined)

  const retryBackfill = useCallback(() => {
    setBackfillTrigger(n => n + 1)
  }, [])

  // ── Ingest logs into state ─────────────────────────────────────────────────
  // Receives all entries to recompute from (needed so save includes full state)
  const ingestLogs = useCallback((rawLogs: Log[], currentEntries: SprayEntry[]): SprayEntry[] => {
    const eid = eventIdRef.current
    if (eid === undefined) return currentEntries
    const newEntries: SprayEntry[] = []
    for (const log of rawLogs) {
      const key = buildKey(log)
      if (seenKeys.current.has(key)) continue
      const entry = toEntry(log, eid)
      if (!entry) continue
      seenKeys.current.add(key)
      newEntries.push(entry)
    }
    if (newEntries.length === 0) return currentEntries
    const combined = [...currentEntries, ...newEntries]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 200)
    return combined
  }, [])

  // ── Fetch one chunk with retry + backoff ──────────────────────────────────
  const fetchChunk = useCallback(async (from: bigint, to: bigint): Promise<Log[]> => {
    if (eventIdRef.current === undefined) return []
    let attempt = 0
    let chunkFrom = from
    let chunkTo   = to

    while (attempt <= MAX_RETRIES) {
      try {
        const logs = await arcPublicClient.getLogs({
          address: SPRAY_ADDRESS,
          event: SPRAYED_ABI,
          fromBlock: chunkFrom,
          toBlock: chunkTo,
        })
        if (currentChunkSize.current < LOG_CHUNK_SIZE) {
          currentChunkSize.current = LOG_CHUNK_SIZE
        }
        return logs
      } catch (err) {
        if (isRangeLimitError(err)) {
          currentChunkSize.current = currentChunkSize.current / 2n || 100n
          chunkTo = chunkFrom + currentChunkSize.current - 1n
          if (chunkTo > to) chunkTo = to
          continue
        }
        if (isRateLimitError(err) && attempt < MAX_RETRIES) {
          await sleep(DELAY_MS * Math.pow(2, attempt))
          attempt++
          continue
        }
        throw err
      }
    }
    return []
  }, [])

  // ── Backfill: from → head ─────────────────────────────────────────────────
  const backfill = useCallback(async (from: bigint) => {
    setIsLoadingHistory(true)
    setLogError('')
    try {
      const head = await arcPublicClient.getBlockNumber()
      let cursor = from
      // Use a local snapshot so we can batch-update state once per chunk
      let snapshot: SprayEntry[] = []
      setEntries(prev => { snapshot = prev; return prev })

      while (cursor <= head) {
        if (eventIdRef.current === undefined) return
        const to = cursor + currentChunkSize.current - 1n < head
          ? cursor + currentChunkSize.current - 1n
          : head
        const logs = await fetchChunk(cursor, to)
        snapshot = ingestLogs(logs, snapshot)
        lastScannedBlock.current = to
        // Update state with the latest snapshot
        const eid = eventIdRef.current
        if (eid !== undefined) {
          setEntries(snapshot)
          saveCache(eid, snapshot, to)
        }
        cursor = to + 1n
        if (cursor <= head) await sleep(DELAY_MS)
      }
    } catch (err) {
      setLogError(`Live feed is catching up… ${cleanFetchError(err)}`)
    } finally {
      setIsLoadingHistory(false)
    }
  }, [fetchChunk, ingestLogs])

  // ── Poll: lastScannedBlock+1 → head ───────────────────────────────────────
  const poll = useCallback(async () => {
    try {
      const head = await arcPublicClient.getBlockNumber()
      const from = lastScannedBlock.current + 1n
      if (from > head) return
      let cursor = from
      let snapshot: SprayEntry[] = []
      setEntries(prev => { snapshot = prev; return prev })

      while (cursor <= head) {
        if (eventIdRef.current === undefined) return
        const to = cursor + currentChunkSize.current - 1n < head
          ? cursor + currentChunkSize.current - 1n
          : head
        const logs = await fetchChunk(cursor, to)
        snapshot = ingestLogs(logs, snapshot)
        lastScannedBlock.current = to
        const eid = eventIdRef.current
        if (eid !== undefined) {
          setEntries(snapshot)
          saveCache(eid, snapshot, to)
        }
        cursor = to + 1n
      }
    } catch {
      // Poll errors are silent — backfill error banner handles persistent failures
    }
  }, [fetchChunk, ingestLogs])

  // ── Main effect ───────────────────────────────────────────────────────────
  useEffect(() => {
    // Capture startBlock once per eventId — don't re-run on bigint identity change
    if (eventId !== eventIdRef.current) {
      startBlockRef.current = startBlock
    }
    eventIdRef.current = eventId

    if (eventId === undefined) return

    const effectiveStart = startBlockRef.current !== undefined &&
      startBlockRef.current >= SPRAY_DEPLOY_BLOCK
      ? startBlockRef.current
      : SPRAY_DEPLOY_BLOCK

    // Load from localStorage cache first — ALWAYS, regardless of event status
    const cached = loadCache(eventId)
    let backfillFrom: bigint

    if (cached && cached.entries.length > 0) {
      // Restore cache — don't clear it
      seenKeys.current = new Set(cached.entries.map(e => e.key))
      lastScannedBlock.current = cached.lastScannedBlock
      setEntries(cached.entries)
      setLogError('')
      // Only fetch blocks we haven't scanned yet
      backfillFrom = cached.lastScannedBlock + 1n
      // If the hint is ahead of the cache, use the hint (shouldn't happen in practice)
      if (effectiveStart > backfillFrom) backfillFrom = effectiveStart
    } else {
      // No cache — scan from scratch
      seenKeys.current = new Set()
      lastScannedBlock.current = effectiveStart - 1n
      setEntries([])
      setLogError('')
      backfillFrom = effectiveStart
    }

    currentChunkSize.current = LOG_CHUNK_SIZE

    // 1. Historical backfill
    void backfill(backfillFrom)

    // 2. 3-second poll fallback
    pollTimer.current = setInterval(() => { void poll() }, 3000)

    // 3. watchEvent for instant delivery
    try {
      unwatchRef.current = arcPublicClient.watchEvent({
        address: SPRAY_ADDRESS,
        event: SPRAYED_ABI,
        onLogs: (newLogs) => {
          setEntries(prev => {
            const updated = ingestLogs(newLogs, prev)
            const eid = eventIdRef.current
            if (eid !== undefined) saveCache(eid, updated, lastScannedBlock.current)
            return updated
          })
        },
        pollingInterval: 3000,
      })
    } catch {
      // best-effort
    }

    return () => {
      if (pollTimer.current) { clearInterval(pollTimer.current); pollTimer.current = null }
      unwatchRef.current?.(); unwatchRef.current = null
    }
  // startBlock intentionally excluded — captured via startBlockRef on eventId change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, backfill, poll, ingestLogs, backfillTrigger])

  return { entries, isLoadingHistory, logError, retryBackfill }
}
