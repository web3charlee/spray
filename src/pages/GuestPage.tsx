import { useState, useRef, useCallback, useMemo } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useSwitchChain, useReadContract } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { erc20Abi } from 'viem'
import { arcPublicClient } from '../utils/publicClient'
import { HelpCircle, CheckCircle, Info } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { SprayLogo } from '../components/SprayLogo'
import { Countdown } from '../components/Countdown'
import { UsdcNeedSheet } from '../components/UsdcNeedSheet'
import { useSprayEvent, useContribution } from '../hooks/useSprayEvent'
import {
  SPRAY_CONTRACT, USDC_ADDRESS, ARC_CHAIN_ID,
  SprayMode, EventStatus, MIN_SPRAY, MAX_SPRAY
} from '../contract'
import { formatUsdc, usdcToNgn, ngnToUsdc, formatAddress } from '../utils/format'
import { parseOnchainError } from '../utils/onchainError'

const NGN_QUICK = [500, 1000, 2000, 5000]
const LOCAL_NAME_KEY = 'spray_display_name'

// Pre-computed stable random values for confetti
const CONFETTI_PRESETS = Array.from({ length: 24 }, () => ({
  dy: -120 - Math.random() * 80,
  dx: (Math.random() - 0.5) * 80,
  rot: 360 * (Math.random() > 0.5 ? 1 : -1),
  dur: 0.9 + Math.random() * 0.4,
}))
const CONFETTI_COLORS = ['#FFD166', '#F5A623', '#7CF2C2', '#FFF6E3', '#FF6B5A']

function Confetti({ trigger }: { trigger: boolean }) {
  return (
    <AnimatePresence>
      {trigger && CONFETTI_PRESETS.map((d, i) => (
        <motion.div
          key={i}
          className="absolute w-2 h-2 rounded-sm pointer-events-none"
          style={{
            backgroundColor: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
            left: `${20 + (i * 2.5) % 60}%`,
            bottom: '50%',
          }}
          initial={{ y: 0, opacity: 1, rotate: 0 }}
          animate={{ y: d.dy, x: d.dx, opacity: 0, rotate: d.rot }}
          transition={{ duration: d.dur, ease: 'easeOut', delay: i * 0.02 }}
        />
      ))}
    </AnimatePresence>
  )
}

type SprayStep = 'idle' | 'approving' | 'spraying' | 'done'

export default function GuestPage() {
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const eventId = id ? parseInt(id) : undefined
  // ?b= is in the URL (placed there by CreatePage) — not used by GuestPage directly
  // but acknowledged so the URL stays clean and WallPage sharing works
  void useMemo(() => searchParams.get('b'), [searchParams])

  const { event, isLoading } = useSprayEvent(eventId)
  const { address, isConnected, chainId } = useAccount()
  const { switchChain, isPending: isSwitching } = useSwitchChain()

  const [displayName, setDisplayName] = useState(() => localStorage.getItem(LOCAL_NAME_KEY) ?? '')
  const [customUsdc, setCustomUsdc] = useState('')
  const [selectedNgn, setSelectedNgn] = useState<number | null>(1000)
  const [helpOpen, setHelpOpen] = useState(false)
  const [confetti, setConfetti] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [sprayStep, setSprayStep] = useState<SprayStep>('idle')
  const btnRef = useRef<HTMLButtonElement | null>(null)

  const wrongChain = isConnected && chainId !== ARC_CHAIN_ID
  const ngnPerUsd = event ? Number(event.ngnPerUsd) : 1600

  const selectedUsdc = selectedNgn !== null
    ? ngnToUsdc(selectedNgn, ngnPerUsd)
    : parseFloat(customUsdc) || 0

  const clampedUsdc = Math.min(Math.max(selectedUsdc, 0), MAX_SPRAY)

  const { data: allowanceData } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address && eventId !== undefined ? [address, SPRAY_CONTRACT.address] : undefined,
    chainId: ARC_CHAIN_ID,
    query: { enabled: !!address && eventId !== undefined, refetchInterval: 5000 },
  })
  const allowance = (allowanceData) ?? 0n

  const { writeContractAsync: approveAsync } = useWriteContract()
  const { writeContractAsync: sprayAsync } = useWriteContract()
  const [approveTx, setApproveTx] = useState<`0x${string}` | undefined>()
  const [sprayTx, setSprayTx] = useState<`0x${string}` | undefined>()
  const { isLoading: approveLoading } = useWaitForTransactionReceipt({ hash: approveTx })
  const { isSuccess: sprayConfirmed, isLoading: sprayLoading } = useWaitForTransactionReceipt({ hash: sprayTx })
  // Show "Waiting for previous tx…" when a tx is submitted but not yet mined
  const isSprayPending = (!!approveTx && approveLoading) || (!!sprayTx && sprayLoading)

  // Track spray success
  const [sprayWasDone, setSprayWasDone] = useState(false)
  if (sprayConfirmed && !sprayWasDone && sprayStep === 'spraying') {
    setSprayWasDone(true)
    setSprayStep('done')
    setSuccessMsg('You don spray! Make e rain.')
    setConfetti(true)
    setTimeout(() => setConfetti(false), 2000)
  }

  function saveName(v: string) {
    setDisplayName(v)
    localStorage.setItem(LOCAL_NAME_KEY, v)
  }

  const doSpray = useCallback(async (usdcAmt: number, dName: string) => {
    if (!event || eventId === undefined) return
    const amountRaw = BigInt(Math.round(usdcAmt * 1e6))
    try {
      setSprayStep('spraying')
      const hash = await sprayAsync({
        ...SPRAY_CONTRACT,
        functionName: 'spray',
        args: [BigInt(eventId), amountRaw, dName],
      })
      setSprayTx(hash)
    } catch (e) {
      setSprayStep('idle')
      setErrorMsg(parseOnchainError(e))
    }
  }, [event, eventId, sprayAsync])

  async function handleSpray() {
    setErrorMsg('')
    const dName = displayName.trim() || 'Anonymous'
    if (!displayName.trim()) { setErrorMsg('Enter your name first.'); return }
    if (clampedUsdc < MIN_SPRAY || clampedUsdc > MAX_SPRAY) {
      setErrorMsg(`Amount must be between $${MIN_SPRAY} and $${MAX_SPRAY}.`); return
    }

    const amountRaw = BigInt(Math.round(clampedUsdc * 1e6))

    if (allowance >= amountRaw) {
      await doSpray(clampedUsdc, dName)
    } else {
      try {
        setSprayStep('approving')
        const hash = await approveAsync({
          address: USDC_ADDRESS,
          abi: erc20Abi,
          functionName: 'approve',
          args: [SPRAY_CONTRACT.address, amountRaw],
        })
        setApproveTx(hash)
        // After approve confirms we need to do spray
        // We wait for the approve receipt then trigger spray
        await waitForApproveAndSpray(hash, clampedUsdc, dName)
      } catch (e) {
        setSprayStep('idle')
        setErrorMsg(parseOnchainError(e))
      }
    }
  }

  // Wait for approve tx then spray — uses the real viem public client
  async function waitForApproveAndSpray(hash: `0x${string}`, usdcAmt: number, dName: string) {
    const maxWait = 60_000
    const start = Date.now()
    while (Date.now() - start < maxWait) {
      await new Promise(r => setTimeout(r, 2000))
      try {
        const receipt = await arcPublicClient.getTransactionReceipt({ hash })
        if (receipt?.status === 'success') {
          await doSpray(usdcAmt, dName)
          return
        }
      } catch {
        // keep polling
      }
    }
    setSprayStep('idle')
    setErrorMsg('Approval timed out. Please try again.')
  }

  const isPOT = event?.mode === SprayMode.POT
  const isOpen = event?.status === EventStatus.OPEN
  const isCancelled = event?.status === EventStatus.CANCELLED
  const isSettled = event?.status === EventStatus.SETTLED
  const unlockTs = event ? Number(event.unlockAt) : 0
  const [nowSec] = useState(() => Math.floor(Date.now() / 1000))
  const potExpired = isPOT && unlockTs > 0 && nowSec >= unlockTs
  const canSpray = isOpen && (!isPOT || !potExpired)

  // Settle (POT, after unlock, anyone can trigger)
  const { writeContractAsync: settleAsync } = useWriteContract()
  const [settleStep, setSettleStep] = useState<'idle' | 'settling' | 'done'>('idle')
  const [settleError, setSettleError] = useState('')
  const [settleTx, setSettleTx] = useState<`0x${string}` | undefined>()
  const { isSuccess: settleConfirmed } = useWaitForTransactionReceipt({ hash: settleTx })
  const [settleWasDone, setSettleWasDone] = useState(false)
  if (settleConfirmed && !settleWasDone) { setSettleWasDone(true); setSettleStep('done') }

  // Refund (POT cancelled, visitor's own contribution)
  const { writeContractAsync: refundAsync } = useWriteContract()
  const [refundStep, setRefundStep] = useState<'idle' | 'refunding' | 'done'>('idle')
  const [refundError, setRefundError] = useState('')
  const [refundTx, setRefundTx] = useState<`0x${string}` | undefined>()
  const { isSuccess: refundConfirmed } = useWaitForTransactionReceipt({ hash: refundTx })
  const [refundWasDone, setRefundWasDone] = useState(false)
  if (refundConfirmed && !refundWasDone) { setRefundWasDone(true); setRefundStep('done') }
  const { contribution } = useContribution(
    isCancelled && eventId !== undefined ? eventId : undefined,
    address
  )

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
        <p className="text-[#FFF6E3]/60">Event not found. Check the link and try again.</p>
      </div>
    )
  }

  return (
    <div className="min-h-dvh px-4 pt-6 pb-20 max-w-md mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <SprayLogo size={24} />
          <span className="font-display font-bold text-[#FFD166] text-base">Spray</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setHelpOpen(true)}
            className="p-2 rounded-full hover:bg-[#0F4A38] transition-colors"
            aria-label="Need USDC?"
          >
            <HelpCircle size={18} className="text-[#FFF6E3]/50" />
          </button>
          <ConnectKitButton />
        </div>
      </div>

      {/* Event hero */}
      <div className="text-center mb-6">
        <span className={`inline-block text-xs font-semibold px-3 py-1 rounded-full mb-3 ${
          isOpen ? 'bg-[#7CF2C2]/15 text-[#7CF2C2]' : 'bg-[#FFF6E3]/10 text-[#FFF6E3]/50'
        }`}>
          {isCancelled ? 'Cancelled' : isSettled ? 'Settled' : isPOT ? 'Pot Event' : 'Live Event'}
        </span>
        <h1 className="font-display font-extrabold text-[#FFF6E3] leading-tight tracking-tight mb-1"
          style={{ fontSize: 'clamp(1.8rem, 8vw, 2.8rem)' }}>
          {event.name}
        </h1>
        <p className="text-[#FFF6E3]/35 text-xs font-mono">{formatAddress(event.host)}</p>
        <div className="mt-3 flex items-center justify-center gap-4 text-sm">
          <span className="text-[#FFF6E3]/50">Sprayed</span>
          <span className="font-display font-bold text-[#FFD166] text-xl tabular-nums">
            ${formatUsdc(event.totalSprayed)}
          </span>
        </div>
        {isPOT && unlockTs > 0 && (
          <div className="mt-2 flex items-center justify-center gap-2 text-sm">
            <span className="text-[#FFF6E3]/50">{potExpired ? 'Ready to settle' : 'Unlocks in'}</span>
            <Countdown targetTs={unlockTs} />
          </div>
        )}
      </div>

      {/* Success banner */}
      <AnimatePresence>
        {sprayStep === 'done' && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="bg-[#7CF2C2]/10 border border-[#7CF2C2]/30 rounded-2xl p-4 mb-6 flex items-center gap-3"
          >
            <CheckCircle size={20} className="text-[#7CF2C2] flex-shrink-0" />
            <p className="text-[#7CF2C2] font-semibold text-sm">{successMsg}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {canSpray && sprayStep !== 'done' && (
        <>
          {/* Your name */}
          <div className="mb-5">
            <label className="block text-[#FFF6E3]/70 text-xs font-medium mb-1.5 uppercase tracking-wider">
              Your Name
            </label>
            <input
              type="text"
              maxLength={32}
              value={displayName}
              onChange={e => saveName(e.target.value)}
              placeholder="Enter your name"
              className="w-full h-14 bg-[#0F4A38] border border-[#1C6B52] rounded-2xl px-4 text-[#FFF6E3] placeholder-[#FFF6E3]/30 focus:outline-none focus:border-[#FFD166]/60 transition-colors"
            />
          </div>

          {/* Amount chips */}
          <div className="mb-2">
            <label className="block text-[#FFF6E3]/70 text-xs font-medium mb-2 uppercase tracking-wider">
              Amount
            </label>
            <div className="grid grid-cols-4 gap-2 mb-3">
              {NGN_QUICK.map(ngn => {
                const usdc = ngnToUsdc(ngn, ngnPerUsd)
                const valid = usdc >= MIN_SPRAY && usdc <= MAX_SPRAY
                const selected = selectedNgn === ngn
                return (
                  <button
                    key={ngn}
                    onClick={() => { setSelectedNgn(ngn); setCustomUsdc('') }}
                    disabled={!valid}
                    className={`flex flex-col items-center py-3 rounded-2xl border transition-all ${
                      selected
                        ? 'bg-gradient-to-b from-[#FFD166] to-[#F5A623] border-[#FFD166] text-[#1A1405]'
                        : valid
                        ? 'bg-[#0F4A38] border-[#1C6B52] text-[#FFF6E3] hover:border-[#FFD166]/40'
                        : 'bg-[#0F4A38]/50 border-[#1C6B52]/50 text-[#FFF6E3]/30 cursor-not-allowed'
                    }`}
                  >
                    <span className="font-bold text-sm">
                      {ngn >= 1000 ? `₦${ngn / 1000}k` : `₦${ngn}`}
                    </span>
                    <span className={`text-xs tabular-nums ${selected ? 'text-[#1A1405]/70' : 'text-[#FFF6E3]/40'}`}>
                      ~${usdc.toFixed(2)}
                    </span>
                  </button>
                )
              })}
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[#FFF6E3]/50 text-sm">Custom USDC:</span>
              <input
                type="number"
                min={MIN_SPRAY}
                max={MAX_SPRAY}
                step="0.1"
                value={customUsdc}
                onChange={e => { setCustomUsdc(e.target.value); setSelectedNgn(null) }}
                placeholder="0.10 – 20"
                className="w-32 h-10 bg-[#0F4A38] border border-[#1C6B52] rounded-xl px-3 text-[#FFF6E3] text-sm tabular-nums focus:outline-none focus:border-[#FFD166]/60 transition-colors"
              />
              <span className="text-[#FFF6E3]/50 text-sm">USDC</span>
            </div>

            {selectedUsdc > 0 && (
              <p className="text-[#FFF6E3]/40 text-xs mt-1.5 tabular-nums">
                ≈ ₦{usdcToNgn(clampedUsdc, ngnPerUsd).toLocaleString('en-NG', { maximumFractionDigits: 0 })} at today's rate
              </p>
            )}
          </div>

          {errorMsg && (
            <div className="mb-4 p-3 bg-[#FF6B5A]/10 border border-[#FF6B5A]/30 rounded-2xl text-[#FF6B5A] text-sm">
              {errorMsg}
            </div>
          )}

          {wrongChain ? (
            <button
              onClick={() => switchChain({ chainId: ARC_CHAIN_ID })}
              disabled={isSwitching}
              className="relative w-full h-16 mt-2 rounded-2xl bg-gradient-to-r from-[#FFD166] to-[#F5A623] text-[#1A1405] font-bold text-lg disabled:opacity-50 transition-all active:scale-95"
            >
              {isSwitching ? 'Switching...' : 'Switch to Arc'}
            </button>
          ) : !isConnected ? (
            <div className="flex justify-center mt-4">
              <ConnectKitButton label="Connect Wallet to Spray" />
            </div>
          ) : (
            <div className="relative mt-4">
              <Confetti trigger={confetti} />
              <motion.button
                ref={btnRef}
                onClick={() => { void handleSpray() }}
                disabled={sprayStep !== 'idle'}
                whileTap={{ scale: 0.96 }}
                className="spray-btn-glow w-full rounded-2xl bg-gradient-to-r from-[#FFD166] to-[#F5A623] text-[#1A1405] font-display font-extrabold tracking-widest disabled:opacity-60 transition-all"
                style={{ height: '88px', fontSize: '2rem', letterSpacing: '0.12em' }}
              >
                {isSprayPending && sprayStep !== 'idle'
                  ? <span className="flex items-center justify-center gap-2 text-base">
                      <span className="w-5 h-5 border-2 border-[#1A1405]/30 border-t-[#1A1405] rounded-full animate-spin" />
                      Waiting for previous transaction…
                    </span>
                  : sprayStep === 'approving'
                  ? <span className="flex items-center justify-center gap-2 text-xl">
                      <span className="w-5 h-5 border-2 border-[#1A1405]/30 border-t-[#1A1405] rounded-full animate-spin" />
                      Approving…
                    </span>
                  : sprayStep === 'spraying'
                  ? <span className="flex items-center justify-center gap-2 text-xl">
                      <span className="w-5 h-5 border-2 border-[#1A1405]/30 border-t-[#1A1405] rounded-full animate-spin" />
                      Spraying…
                    </span>
                  : 'SPRAY'
                }
              </motion.button>
              {sprayStep === 'approving' && !isSprayPending && (
                <p className="text-[#FFF6E3]/50 text-xs text-center mt-2">
                  Step 1 of 2: Approve USDC spend in your wallet
                </p>
              )}
              {sprayStep === 'spraying' && !isSprayPending && (
                <p className="text-[#FFF6E3]/50 text-xs text-center mt-2">
                  Step 2 of 2: Confirm spray in your wallet
                </p>
              )}
            </div>
          )}
        </>
      )}

      {/* POT notice — shown on open POT events before unlock */}
      {isPOT && isOpen && !potExpired && (
        <div className="mt-4 flex items-start gap-2 bg-[#0F4A38]/60 border border-[#1C6B52]/60 rounded-2xl p-4">
          <Info size={16} className="text-[#FFF6E3]/40 flex-shrink-0 mt-0.5" />
          <p className="text-[#FFF6E3]/50 text-xs leading-relaxed">
            The host can cancel this Pot before it unlocks. If they do, you can come back here to get a full refund of exactly what you sprayed.
          </p>
        </div>
      )}

      {/* POT expired — Settle button (anyone can call) */}
      {isPOT && isOpen && potExpired && (
        <div className="mt-6">
          {settleStep === 'done' || settleConfirmed ? (
            <div className="bg-[#7CF2C2]/10 border border-[#7CF2C2]/30 rounded-2xl p-4 text-center">
              <p className="text-[#7CF2C2] font-semibold text-sm">Pot settled! Recipients can now withdraw.</p>
            </div>
          ) : (
            <>
              <button
                onClick={() => void (async () => {
                  if (eventId === undefined) return
                  setSettleError('')
                  try {
                    setSettleStep('settling')
                    const hash = await settleAsync({
                      ...SPRAY_CONTRACT,
                      functionName: 'settle',
                      args: [BigInt(eventId)],
                    })
                    setSettleTx(hash)
                  } catch (e) { setSettleStep('idle'); setSettleError(parseOnchainError(e)) }
                })()}
                disabled={settleStep !== 'idle'}
                className="w-full h-16 rounded-2xl bg-gradient-to-r from-[#FFD166] to-[#F5A623] text-[#1A1405] font-display font-bold text-xl disabled:opacity-60 transition-all active:scale-95 flex items-center justify-center gap-2"
              >
                {settleStep === 'settling'
                  ? <><span className="w-5 h-5 border-2 border-[#1A1405]/30 border-t-[#1A1405] rounded-full animate-spin" /> Settling...</>
                  : 'Settle the Pot'}
              </button>
              {settleError && <p className="text-[#FF6B5A] text-xs text-center mt-2">{settleError}</p>}
            </>
          )}
        </div>
      )}

      {/* POT cancelled — show Refund button to contributors */}
      {isPOT && isCancelled && (
        <div className="mt-6 bg-[#0F4A38] border border-[#1C6B52] rounded-3xl p-5">
          <p className="text-[#FFF6E3]/70 text-sm font-medium mb-1">This Pot was cancelled by the host.</p>
          {contribution && contribution > 0n ? (
            <>
              <p className="text-[#FFF6E3]/50 text-xs mb-4">
                You sprayed ${formatUsdc(contribution)} USDC — claim it back below.
              </p>
              {refundStep === 'done' || refundConfirmed ? (
                <div className="bg-[#7CF2C2]/10 border border-[#7CF2C2]/30 rounded-2xl p-3 text-center">
                  <p className="text-[#7CF2C2] font-semibold text-sm">Refunded! USDC is back in your wallet.</p>
                </div>
              ) : (
                <>
                  <button
                    onClick={() => void (async () => {
                      if (eventId === undefined) return
                      setRefundError('')
                      try {
                        setRefundStep('refunding')
                        const hash = await refundAsync({
                          ...SPRAY_CONTRACT,
                          functionName: 'refund',
                          args: [BigInt(eventId)],
                        })
                        setRefundTx(hash)
                      } catch (e) { setRefundStep('idle'); setRefundError(parseOnchainError(e)) }
                    })()}
                    disabled={refundStep !== 'idle' || !isConnected}
                    className="w-full h-14 rounded-2xl bg-gradient-to-r from-[#FFD166] to-[#F5A623] text-[#1A1405] font-bold text-lg disabled:opacity-60 transition-all active:scale-95 flex items-center justify-center gap-2"
                  >
                    {refundStep === 'refunding'
                      ? <><span className="w-5 h-5 border-2 border-[#1A1405]/30 border-t-[#1A1405] rounded-full animate-spin" /> Refunding...</>
                      : `Refund $${formatUsdc(contribution)}`}
                  </button>
                  {!isConnected && <p className="text-[#FFF6E3]/40 text-xs text-center mt-2">Connect your wallet to refund.</p>}
                  {refundError && <p className="text-[#FF6B5A] text-xs text-center mt-2">{refundError}</p>}
                </>
              )}
            </>
          ) : (
            <p className="text-[#FFF6E3]/40 text-xs">
              {isConnected ? 'No contribution found for your wallet on this event.' : 'Connect your wallet to check for a refund.'}
            </p>
          )}
        </div>
      )}

      {!canSpray && !isCancelled && !(isPOT && potExpired) && (
        <div className="bg-[#0F4A38] border border-[#1C6B52] rounded-3xl p-5 text-center mt-4">
          <p className="text-[#FFF6E3]/60">
            {isSettled
              ? 'Pot has been settled. Make e rain next time!'
              : event.status === EventStatus.CLOSED
              ? 'This event is closed.'
              : 'Event is not accepting sprays right now.'}
          </p>
        </div>
      )}

      <UsdcNeedSheet open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  )
}


