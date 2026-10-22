import { useState, useMemo } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { motion, AnimatePresence } from 'framer-motion'
import { EyeOff, AlertTriangle, RefreshCw } from 'lucide-react'
import { SprayLogo } from '../components/SprayLogo'
import { Countdown } from '../components/Countdown'
import { useSprayEvent } from '../hooks/useSprayEvent'
import { useSprayLogs } from '../hooks/useSprayLogs'
import { SPRAY_CONTRACT, SprayMode, EventStatus } from '../contract'
import { formatUsdc, formatNgn, formatAddress } from '../utils/format'
import { parseOnchainError } from '../utils/onchainError'

// ── Offensive-word filter ────────────────────────────────────────────────────
const BLOCKED_WORDS = [
  'fuck', 'shit', 'cunt', 'nigger', 'nigga', 'faggot', 'bitch',
  'asshole', 'bastard', 'whore', 'slut', 'dick', 'cock', 'pussy',
  'retard', 'kike', 'spic', 'chink', 'wetback',
]
const BLOCKED_RE = new RegExp(`\\b(${BLOCKED_WORDS.join('|')})\\b`, 'i')

function sanitizeName(name: string): string {
  const truncated = name.length > 24 ? name.slice(0, 24) + '…' : name
  return BLOCKED_RE.test(truncated) ? '••••' : truncated
}

// ── Host-hidden entries (stored in localStorage per wall) ────────────────────
function hiddenStorageKey(eventId: number) { return `spray_wall_hidden_${eventId}` }
function loadHidden(eventId: number): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(hiddenStorageKey(eventId)) ?? '[]') as string[]) }
  catch { return new Set() }
}
function saveHidden(eventId: number, keys: Set<string>) {
  localStorage.setItem(hiddenStorageKey(eventId), JSON.stringify([...keys]))
}

// Pre-computed confetti
const CONFETTI_DATA = Array.from({ length: 60 }, () => ({
  dy: -(300 + Math.random() * 200),
  dx: (Math.random() - 0.5) * 200,
  rot: 720 * (Math.random() > 0.5 ? 1 : -1),
  dur: 2 + Math.random(),
}))
const CONFETTI_COLORS = ['#FFD166', '#F5A623', '#7CF2C2', '#FFF6E3', '#FF6B5A']

function ConfettiCelebration({ active }: { active: boolean }) {
  return (
    <AnimatePresence>
      {active && CONFETTI_DATA.map((d, i) => (
        <motion.div
          key={i}
          className="fixed pointer-events-none z-50 w-3 h-3 rounded-sm"
          style={{
            backgroundColor: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
            left: `${(i * 1.7) % 100}%`,
            top: '40%',
          }}
          initial={{ y: 0, opacity: 1, rotate: 0 }}
          animate={{ y: d.dy, x: d.dx, opacity: 0, rotate: d.rot }}
          transition={{ duration: d.dur, ease: 'easeOut', delay: i * 0.03 }}
        />
      ))}
    </AnimatePresence>
  )
}

export default function WallPage() {
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const eventId = id ? parseInt(id) : undefined
  // ?b= hint: start scanning from the event's creation block, skip older history
  const startBlock = useMemo(() => {
    const b = searchParams.get('b')
    if (!b) return undefined
    try { return BigInt(b) } catch { return undefined }
  }, [searchParams])

  const { event, isLoading, refetch } = useSprayEvent(eventId)
  const { address } = useAccount()

  const { entries, isLoadingHistory, logError, retryBackfill } =
    useSprayLogs(eventId, startBlock)

  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(() =>
    eventId !== undefined ? loadHidden(eventId) : new Set()
  )
  const [potUnlocked, setPotUnlocked] = useState(false)
  const [celebration, setCelebration] = useState(false)
  const [settleStep, setSettleStep] = useState<'idle' | 'settling' | 'done'>('idle')
  const [settleError, setSettleError] = useState('')

  const isHost = !!address && !!event?.host &&
    address.toLowerCase() === event.host.toLowerCase()

  // Derived values — all computed from visibleEntries so Sprayers/leaderboard
  // are always consistent with what the feed shows (respects host hide)
  const visibleEntries = useMemo(
    () => entries.filter(e => !hiddenKeys.has(e.key)),
    [entries, hiddenKeys]
  )
  const hiddenCount = entries.length - visibleEntries.length

  const senderCount = useMemo(
    () => new Set(visibleEntries.map(e => e.from.toLowerCase())).size,
    [visibleEntries]
  )

  const leaderboard = useMemo(() => {
    const byName: Record<string, bigint> = {}
    for (const e of visibleEntries) {
      byName[e.displayName] = (byName[e.displayName] ?? 0n) + e.amount
    }
    return Object.entries(byName)
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => (a.total < b.total ? 1 : -1))
      .slice(0, 10)
  }, [visibleEntries])

  function hideEntry(key: string) {
    if (eventId === undefined) return
    setHiddenKeys(prev => {
      const next = new Set(prev)
      next.add(key)
      saveHidden(eventId, next)
      return next
    })
  }

  const { writeContractAsync } = useWriteContract()
  const [settleTx, setSettleTx] = useState<`0x${string}` | undefined>()
  const { isSuccess: settleConfirmed } = useWaitForTransactionReceipt({ hash: settleTx })

  const [settleWasDone, setSettleWasDone] = useState(false)
  if (settleConfirmed && !settleWasDone) {
    setSettleWasDone(true)
    setSettleStep('done')
    void refetch()
  }

  function handlePotUnlocked() {
    setPotUnlocked(true)
    setCelebration(true)
    setTimeout(() => setCelebration(false), 3000)
  }

  async function handleSettle() {
    if (eventId === undefined) return
    setSettleError('')
    try {
      setSettleStep('settling')
      const hash = await writeContractAsync({
        ...SPRAY_CONTRACT,
        functionName: 'settle',
        args: [BigInt(eventId)],
      })
      setSettleTx(hash)
    } catch (e) {
      setSettleStep('idle')
      setSettleError(parseOnchainError(e))
    }
  }

  const isPOT = event?.mode === SprayMode.POT
  const isOpen = event?.status === EventStatus.OPEN
  const unlockTs = event ? Number(event.unlockAt) : 0
  const alreadySettled = event?.status === EventStatus.SETTLED
  // Use a state-based "now" so it's stable during render (not Date.now() inline)
  const [renderNow] = useState(() => Math.floor(Date.now() / 1000))
  // Pending-tx detection: if settleTx is set but not yet confirmed, show waiting msg
  const isSettlePending = !!settleTx && settleStep === 'settling' && !settleConfirmed

  if (isLoading) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#FFD166]/30 border-t-[#FFD166] rounded-full animate-spin" />
      </div>
    )
  }

  if (!event || !event.host || event.host === '0x0000000000000000000000000000000000000000') {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center px-4 text-center gap-4">
        <SprayLogo size={48} />
        <p className="text-[#FFF6E3]/60">Wall not found.</p>
      </div>
    )
  }

  return (
    <div className="min-h-dvh flex flex-col max-w-2xl mx-auto px-4 pt-6 pb-10">
      <ConfettiCelebration active={celebration} />

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <SprayLogo size={32} />
          <div>
            <h1 className="font-display font-bold text-[#FFF6E3] text-2xl tracking-tight leading-none">
              {event.name}
            </h1>
            <p className="text-[#FFF6E3]/40 text-xs font-mono mt-0.5">{formatAddress(event.host)}</p>
          </div>
        </div>
        <span className={`text-xs font-semibold px-3 py-1.5 rounded-full ${
          isOpen ? 'bg-[#7CF2C2]/15 text-[#7CF2C2]' : 'bg-[#FFF6E3]/10 text-[#FFF6E3]/50'
        }`}>
          {alreadySettled ? 'Settled' : isPOT ? 'Pot' : 'Live'}
        </span>
      </div>

      {/* Error / catching-up banner */}
      {logError && (
        <div className="mb-4 flex items-start gap-3 bg-[#FF6B5A]/10 border border-[#FF6B5A]/30 rounded-2xl p-4">
          <AlertTriangle size={16} className="text-[#FF6B5A] flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-[#FF6B5A] text-sm">{logError}</p>
          </div>
          <button
            onClick={retryBackfill}
            className="flex items-center gap-1.5 text-[#FF6B5A] text-xs font-semibold hover:text-[#FF6B5A]/80 flex-shrink-0"
          >
            <RefreshCw size={13} /> Retry
          </button>
        </div>
      )}
      {isLoadingHistory && !logError && (
        <div className="mb-4 flex items-center gap-3 bg-[#0F4A38]/60 border border-[#1C6B52]/60 rounded-2xl px-4 py-3">
          <span className="w-4 h-4 border-2 border-[#FFD166]/30 border-t-[#FFD166] rounded-full animate-spin flex-shrink-0" />
          <p className="text-[#FFF6E3]/50 text-sm">Live feed is catching up…</p>
        </div>
      )}

      {/* Stats — large animated total */}
      <motion.div
        key={event.totalSprayed.toString()}
        className="bg-[#0F4A38] border border-[#1C6B52] rounded-3xl p-5 mb-4"
        animate={{ scale: [1, 1.03, 1] }}
        transition={{ duration: 0.35 }}
      >
        <p className="text-[#FFF6E3]/50 text-xs mb-1 text-center">Total Sprayed</p>
        <p
          className="font-display font-extrabold text-[#FFD166] tabular-nums text-center"
          style={{ fontSize: 'clamp(2.2rem, 10vw, 3.5rem)', lineHeight: 1.1 }}
        >
          ${formatUsdc(event.totalSprayed)}
        </p>
        <p className="text-[#FFF6E3]/40 text-sm tabular-nums text-center">
          ₦{formatNgn(event.totalSprayed, event.ngnPerUsd)}
        </p>
      </motion.div>

      <div className="grid grid-cols-2 gap-3 mb-5">
        {/* Sprayers = distinct sender addresses */}
        <div className="bg-[#0F4A38] border border-[#1C6B52] rounded-3xl p-4">
          <p className="text-[#FFF6E3]/50 text-xs mb-1">Sprayers</p>
          <p className="font-display font-bold text-[#FFF6E3] text-2xl tabular-nums">
            {isLoadingHistory ? (
              <span className="inline-block w-6 h-6 border-2 border-[#FFD166]/30 border-t-[#FFD166] rounded-full animate-spin align-middle" />
            ) : senderCount}
          </p>
        </div>
        <div className="bg-[#0F4A38] border border-[#1C6B52] rounded-3xl p-4">
          <p className="text-[#FFF6E3]/50 text-xs mb-1">{isPOT ? 'Pot Status' : 'Mode'}</p>
          {isPOT && unlockTs > 0 ? (
            potUnlocked || alreadySettled
              ? <span className="text-[#7CF2C2] font-bold text-sm">Unlocked!</span>
              : <Countdown targetTs={unlockTs} onExpired={handlePotUnlocked} />
          ) : (
            <span className="text-[#FFD166] font-bold text-sm">Live</span>
          )}
        </div>
      </div>

      {/* Settle button */}
      {isPOT && isOpen && (potUnlocked || (unlockTs > 0 && renderNow >= unlockTs)) && settleStep !== 'done' && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="mb-6"
        >
          <button
            onClick={() => { void handleSettle() }}
            disabled={settleStep !== 'idle'}
            className="w-full h-16 rounded-2xl bg-gradient-to-r from-[#FFD166] to-[#F5A623] text-[#1A1405] font-display font-bold text-xl disabled:opacity-60 transition-all active:scale-95 flex items-center justify-center gap-2"
          >
            {isSettlePending
              ? <><span className="w-5 h-5 border-2 border-[#1A1405]/30 border-t-[#1A1405] rounded-full animate-spin" /> Waiting for your previous transaction…</>
              : settleStep === 'settling'
              ? <><span className="w-5 h-5 border-2 border-[#1A1405]/30 border-t-[#1A1405] rounded-full animate-spin" /> Settling pot…</>
              : 'Settle the Pot'
            }
          </button>
          {settleError && <p className="text-[#FF6B5A] text-xs text-center mt-2">{settleError}</p>}
        </motion.div>
      )}

      {settleStep === 'done' && (
        <div className="mb-6 bg-[#7CF2C2]/10 border border-[#7CF2C2]/30 rounded-2xl p-4 text-center">
          <p className="text-[#7CF2C2] font-semibold">Pot settled! Recipients can now withdraw.</p>
        </div>
      )}

      <div className="flex gap-3 flex-col-reverse md:flex-row">
        {/* Live feed */}
        <div className="flex-1">
          <h2 className="font-display font-semibold text-[#FFF6E3]/70 text-sm uppercase tracking-wider mb-3">
            Live Feed
          </h2>

          {isLoadingHistory && visibleEntries.length === 0 && hiddenCount === 0 ? (
            <div className="bg-[#0F4A38] border border-[#1C6B52] rounded-3xl p-8 text-center">
              <div className="flex items-center justify-center gap-2 text-[#FFF6E3]/40">
                <span className="w-4 h-4 border-2 border-[#FFD166]/30 border-t-[#FFD166] rounded-full animate-spin" />
                <span>Loading sprays…</span>
              </div>
            </div>
          ) : !logError && visibleEntries.length === 0 ? (
            <div className="bg-[#0F4A38] border border-[#1C6B52] rounded-3xl p-8 text-center">
              {hiddenCount > 0
                ? <p className="text-[#FFF6E3]/40">
                    {hiddenCount} {hiddenCount === 1 ? 'spray' : 'sprays'} hidden by host.
                  </p>
                : <p className="text-[#FFF6E3]/40">Nobody don spray yet. Be the first.</p>
              }
            </div>
          ) : (
            <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
              <AnimatePresence initial={false}>
                {visibleEntries.map(e => {
                  const safeName = sanitizeName(e.displayName)
                  return (
                    <motion.div
                      key={e.key}
                      initial={{ y: -28, opacity: 0, scale: 0.95 }}
                      animate={{ y: 0, opacity: 1, scale: 1 }}
                      transition={{ type: 'spring', stiffness: 320, damping: 24 }}
                      className="relative bg-[#0F4A38] border border-[#1C6B52] rounded-2xl px-4 py-3 flex items-center justify-between gap-3 overflow-hidden"
                    >
                      {/* Floating note on entry */}
                      <motion.span
                        className="absolute top-1 right-6 text-[#FFD166]/50 pointer-events-none select-none"
                        style={{ fontSize: 18 }}
                        initial={{ y: 0, opacity: 0.7 }}
                        animate={{ y: -32, opacity: 0 }}
                        transition={{ duration: 0.9, ease: 'easeOut' }}
                      >♪</motion.span>

                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-full bg-[#FFD166]/15 flex items-center justify-center flex-shrink-0">
                          <span className="font-display font-bold text-[#FFD166] text-xs">
                            {safeName.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <span className="text-[#FFF6E3] font-medium text-sm truncate">{safeName}</span>
                      </div>

                      <div className="flex items-center gap-2 flex-shrink-0">
                        <div className="text-right">
                          <p className="text-[#FFD166] font-bold text-sm tabular-nums">${formatUsdc(e.amount)}</p>
                          <p className="text-[#FFF6E3]/30 text-xs tabular-nums">
                            ₦{formatNgn(e.amount, event.ngnPerUsd)}
                          </p>
                        </div>
                        {isHost && (
                          <button
                            onClick={() => hideEntry(e.key)}
                            title="Hide this spray"
                            className="p-1.5 rounded-lg hover:bg-[#FF6B5A]/15 text-[#FFF6E3]/30 hover:text-[#FF6B5A] transition-colors flex-shrink-0"
                            aria-label="Hide spray"
                          >
                            <EyeOff size={14} />
                          </button>
                        )}
                      </div>
                    </motion.div>
                  )
                })}
              </AnimatePresence>
            </div>
          )}
        </div>

        {/* Leaderboard */}
        {leaderboard.length > 0 && (
          <div className="md:w-52">
            <h2 className="font-display font-semibold text-[#FFF6E3]/70 text-sm uppercase tracking-wider mb-3">
              Top Sprayers
            </h2>
            <div className="bg-[#0F4A38] border border-[#1C6B52] rounded-3xl overflow-hidden">
              {leaderboard.slice(0, 5).map((item, i) => (
                <div
                  key={item.name}
                  className={`flex items-center gap-3 px-4 py-3 ${i < leaderboard.slice(0, 5).length - 1 ? 'border-b border-[#1C6B52]/50' : ''}`}
                >
                  <span className={`font-display font-bold text-sm w-5 text-right flex-shrink-0 ${
                    i === 0 ? 'text-[#FFD166]' : i === 1 ? 'text-[#FFF6E3]/70' : 'text-[#FFF6E3]/40'
                  }`}>{i + 1}</span>
                  <span className="text-[#FFF6E3] text-sm flex-1 truncate">{sanitizeName(item.name)}</span>
                  <span className="text-[#FFD166] text-sm font-semibold tabular-nums">${formatUsdc(item.total)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Chain info footer */}
      <p className="text-[#FFF6E3]/20 text-xs text-center mt-8 font-mono">
        Arc · {SPRAY_CONTRACT.address.slice(0, 10)}…
      </p>
    </div>
  )
}
