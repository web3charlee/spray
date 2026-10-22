import { useState } from 'react'
import { useAccount, useWriteContract, useSwitchChain, useWaitForTransactionReceipt } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { decodeEventLog } from 'viem'
import { Plus, Trash2, ArrowRight, Zap, Lock, Copy, Check, ExternalLink } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { motion, AnimatePresence } from 'framer-motion'
import { SprayLogo } from '../components/SprayLogo'
import { SPRAY_CONTRACT, ARC_CHAIN_ID, SprayMode } from '../contract'
import { parseOnchainError } from '../utils/onchainError'
import { arcPublicClient } from '../utils/publicClient'

interface Recipient {
  address: string
  pct: number
}

const DEFAULT_RECIPIENTS: Recipient[] = [{ address: '', pct: 100 }]

function sumPct(rs: Recipient[]): number {
  return rs.reduce((s, r) => s + r.pct, 0)
}

function ngnPreview(ngnPerUsd: number): string {
  if (!ngnPerUsd || ngnPerUsd <= 0) return ''
  const usd = (1000 / ngnPerUsd).toFixed(2)
  return `₦1,000 ≈ $${usd}`
}

// Read the EventCreated eventId AND blockNumber from the tx receipt
async function readEventIdFromReceipt(
  txHash: `0x${string}`
): Promise<{ eventId: bigint; blockNumber: bigint } | null> {
  try {
    const receipt = await arcPublicClient.getTransactionReceipt({ hash: txHash })
    if (!receipt?.logs) return null
    for (const log of receipt.logs) {
      if (!log.topics[0]) continue
      try {
        const decoded = decodeEventLog({
          abi: SPRAY_CONTRACT.abi,
          eventName: 'EventCreated',
          topics: log.topics,
          data: log.data,
        })
        const args = decoded.args as { eventId: bigint } | undefined
        if (args?.eventId !== undefined) {
          return { eventId: args.eventId, blockNumber: receipt.blockNumber ?? 0n }
        }
      } catch {
        // not the EventCreated log — try next
      }
    }
    return null
  } catch {
    return null
  }
}

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1800)
        })
      }}
      className="p-2 rounded-xl hover:bg-[#1C6B52] transition-colors flex-shrink-0"
      title="Copy"
    >
      {copied ? <Check size={15} className="text-[#7CF2C2]" /> : <Copy size={15} className="text-[#FFF6E3]/50" />}
    </button>
  )
}

export default function CreatePage() {
  const { isConnected, chainId } = useAccount()
  const { switchChain, isPending: isSwitching } = useSwitchChain()

  const [mode, setMode] = useState<'LIVE' | 'POT'>('LIVE')
  const [name, setName] = useState('')
  const [recipients, setRecipients] = useState<Recipient[]>(DEFAULT_RECIPIENTS)
  const [ngnPerUsd, setNgnPerUsd] = useState(1600)
  const [unlockDate, setUnlockDate] = useState('')
  const [unlockTime, setUnlockTime] = useState('18:00')
  const [error, setError] = useState('')

  const [step, setStep] = useState<'idle' | 'creating' | 'reading' | 'done'>('idle')
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>()
  const [createdEventId, setCreatedEventId] = useState<number | null>(null)
  const [createdBlockNumber, setCreatedBlockNumber] = useState<bigint | null>(null)
  const [minDate] = useState(() => new Date().toISOString().split('T')[0])

  const { writeContractAsync } = useWriteContract()
  const { isSuccess: txConfirmed } = useWaitForTransactionReceipt({ hash: txHash })

  // Once tx confirms, read the eventId from the receipt
  const [didReadId, setDidReadId] = useState(false)
  if (txConfirmed && !didReadId && txHash) {
    setDidReadId(true)
    void readEventIdFromReceipt(txHash).then(result => {
      if (result !== null) {
        setCreatedEventId(Number(result.eventId))
        setCreatedBlockNumber(result.blockNumber)
      }
      setStep('done')
    })
  }

  const wrongChain = isConnected && chainId !== ARC_CHAIN_ID
  const totalPct = sumPct(recipients)
  const pctOk = totalPct === 100

  function addRecipient() {
    if (recipients.length >= 10) return
    setRecipients(rs => [...rs, { address: '', pct: 0 }])
  }

  function removeRecipient(i: number) {
    setRecipients(rs => rs.filter((_, idx) => idx !== i))
  }

  function updateAddress(i: number, val: string) {
    setRecipients(rs => rs.map((r, idx) => idx === i ? { ...r, address: val } : r))
  }

  function stepPct(i: number, delta: number) {
    setRecipients(rs => rs.map((r, idx) => {
      if (idx !== i) return r
      return { ...r, pct: Math.max(0, Math.min(100, r.pct + delta)) }
    }))
  }

  function autoBalance() {
    const n = recipients.length
    const base = Math.floor(100 / n)
    const rest = 100 - base * n
    setRecipients(rs => rs.map((r, i) => ({ ...r, pct: i === 0 ? base + rest : base })))
  }

  async function handleCreate() {
    setError('')
    if (!name.trim()) { setError('Give your event a name.'); return }
    if (name.trim().length > 64) { setError('Name must be 64 chars or less.'); return }
    if (!pctOk) { setError('Shares must add up to exactly 100%.'); return }
    for (const r of recipients) {
      if (!r.address.match(/^0x[0-9a-fA-F]{40}$/)) {
        setError('One or more recipient addresses look invalid.'); return
      }
    }
    if (mode === 'POT' && !unlockDate) { setError('Pick an unlock date for the pot.'); return }
    if (ngnPerUsd < 100 || ngnPerUsd > 10000) { setError('Naira rate must be between 100 and 10,000.'); return }

    let unlockAt = 0n
    if (mode === 'POT') {
      const dt = new Date(`${unlockDate}T${unlockTime}`)
      unlockAt = BigInt(Math.floor(dt.getTime() / 1000))
      const now = BigInt(Math.floor(Date.now() / 1000))
      if (unlockAt <= now) { setError('Unlock time must be in the future.'); return }
      if (unlockAt > now + 90n * 24n * 3600n) { setError('Unlock must be within 90 days.'); return }
    }

    const sharesBps = recipients.map(r => Math.round((r.pct / 100) * 10000))
    const bpsSum = sharesBps.reduce((a, b) => a + b, 0)
    if (bpsSum !== 10000) sharesBps[0] += (10000 - bpsSum)

    try {
      setStep('creating')
      const hash = await writeContractAsync({
        ...SPRAY_CONTRACT,
        functionName: 'createEvent',
        args: [
          name.trim(),
          recipients.map(r => r.address as `0x${string}`),
          sharesBps,
          mode === 'LIVE' ? SprayMode.LIVE : SprayMode.POT,
          unlockAt,
          BigInt(ngnPerUsd),
        ],
      })
      setTxHash(hash)
      setStep('reading')
    } catch (e: unknown) {
      setStep('idle')
      setError(parseOnchainError(e))
    }
  }

  if (step === 'done' || step === 'reading') {
    return <CreateSuccess name={name} mode={mode} eventId={createdEventId} blockNumber={createdBlockNumber} loading={step === 'reading'} />
  }

  return (
    <div className="min-h-dvh px-4 pt-6 pb-20 max-w-md mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-2">
          <SprayLogo size={28} />
          <span className="font-display font-bold text-[#FFD166] text-xl tracking-tight">Spray</span>
        </div>
        <ConnectKitButton />
      </div>

      <h1 className="font-display font-bold text-[#FFF6E3] text-3xl mb-1 tracking-tight">Create Event</h1>
      <p className="text-[#FFF6E3]/60 text-sm mb-7">Set up your owambe and let the money rain.</p>

      {/* Mode cards */}
      <div className="grid grid-cols-2 gap-3 mb-7">
        {([
          { id: 'LIVE' as const, icon: Zap, label: 'Live Spray', desc: 'Sprays credit recipients the moment they land.' },
          { id: 'POT' as const, icon: Lock, label: 'Pot (Locked)', desc: 'All sprays held until your chosen unlock time.' },
        ] as const).map(({ id, icon: Icon, label, desc }) => (
          <button
            key={id}
            onClick={() => setMode(id)}
            className={`relative flex flex-col items-start p-4 rounded-3xl border-2 text-left transition-all ${
              mode === id
                ? 'border-[#FFD166] bg-[#FFD166]/8'
                : 'border-[#1C6B52] bg-[#0F4A38] hover:border-[#FFD166]/40'
            }`}
          >
            <div className={`w-10 h-10 rounded-2xl flex items-center justify-center mb-3 ${
              mode === id ? 'bg-[#FFD166]/20' : 'bg-[#1C6B52]/60'
            }`}>
              <Icon size={20} className={mode === id ? 'text-[#FFD166]' : 'text-[#FFF6E3]/50'} />
            </div>
            <p className={`font-display font-bold text-sm mb-1 ${mode === id ? 'text-[#FFD166]' : 'text-[#FFF6E3]'}`}>
              {label}
            </p>
            <p className="text-[#FFF6E3]/40 text-xs leading-snug">{desc}</p>
            {mode === id && (
              <span className="absolute top-3 right-3 w-2 h-2 rounded-full bg-[#FFD166]" />
            )}
          </button>
        ))}
      </div>

      {/* Event name */}
      <div className="mb-5">
        <label className="block text-[#FFF6E3]/70 text-xs font-medium mb-1.5 uppercase tracking-wider">
          Event Name
        </label>
        <input
          type="text"
          maxLength={64}
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Adaeze & Emeka's Wedding"
          className="w-full h-14 bg-[#0F4A38] border border-[#1C6B52] rounded-2xl px-4 text-[#FFF6E3] placeholder-[#FFF6E3]/30 focus:outline-none focus:border-[#FFD166]/60 transition-colors"
        />
        <p className="text-[#FFF6E3]/30 text-xs mt-1 text-right">{name.length}/64</p>
      </div>

      {/* Recipients */}
      <div className="mb-5">
        <div className="flex items-center justify-between mb-2">
          <label className="text-[#FFF6E3]/70 text-xs font-medium uppercase tracking-wider">
            Recipients
          </label>
          <button onClick={autoBalance} className="text-[#FFD166] text-xs font-medium hover:underline">
            Auto-balance
          </button>
        </div>

        <div className="space-y-2">
          {recipients.map((r, i) => (
            <div key={i} className="flex gap-2 items-center bg-[#0F4A38] border border-[#1C6B52] rounded-2xl px-3 py-2">
              <input
                type="text"
                placeholder="0x… address"
                value={r.address}
                onChange={e => updateAddress(i, e.target.value)}
                className="flex-1 h-10 bg-transparent text-[#FFF6E3] text-sm font-mono placeholder-[#FFF6E3]/25 focus:outline-none min-w-0"
              />
              {/* Percent stepper */}
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={() => stepPct(i, -5)}
                  className="w-7 h-7 rounded-lg bg-[#1C6B52] hover:bg-[#246057] text-[#FFF6E3] text-sm font-bold transition-colors"
                >−</button>
                <span className="w-10 text-center text-[#FFD166] font-bold text-sm tabular-nums">{r.pct}%</span>
                <button
                  onClick={() => stepPct(i, 5)}
                  className="w-7 h-7 rounded-lg bg-[#1C6B52] hover:bg-[#246057] text-[#FFF6E3] text-sm font-bold transition-colors"
                >+</button>
              </div>
              {recipients.length > 1 && (
                <button onClick={() => removeRecipient(i)} className="p-1 text-[#FF6B5A]/50 hover:text-[#FF6B5A] transition-colors">
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          ))}
        </div>

        <div className={`mt-2 text-xs font-semibold ${pctOk ? 'text-[#7CF2C2]' : 'text-[#FF6B5A]'}`}>
          Total: {totalPct}% {pctOk ? '✓' : '— must be 100%'}
        </div>

        {recipients.length < 10 && (
          <button onClick={addRecipient} className="mt-3 flex items-center gap-1.5 text-[#FFD166] text-sm font-medium hover:underline">
            <Plus size={14} /> Add recipient
          </button>
        )}
      </div>

      {/* NGN rate with live preview */}
      <div className="mb-5">
        <label className="block text-[#FFF6E3]/70 text-xs font-medium mb-1.5 uppercase tracking-wider">
          Naira Rate (₦ per $1)
        </label>
        <input
          type="number"
          min="100"
          max="10000"
          value={ngnPerUsd}
          onChange={e => setNgnPerUsd(parseInt(e.target.value) || 0)}
          className="w-full h-14 bg-[#0F4A38] border border-[#1C6B52] rounded-2xl px-4 text-[#FFF6E3] tabular-nums focus:outline-none focus:border-[#FFD166]/60 transition-colors"
        />
        {ngnPerUsd >= 100 && ngnPerUsd <= 10000 && (
          <p className="text-[#FFD166]/70 text-xs mt-1.5 tabular-nums">{ngnPreview(ngnPerUsd)} · shown to guests</p>
        )}
      </div>

      {/* Unlock time for POT */}
      <AnimatePresence>
        {mode === 'POT' && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-5 overflow-hidden"
          >
            <label className="block text-[#FFF6E3]/70 text-xs font-medium mb-1.5 uppercase tracking-wider">
              Unlock Date & Time
            </label>
            <div className="flex gap-2">
              <input
                type="date"
                value={unlockDate}
                onChange={e => setUnlockDate(e.target.value)}
                min={minDate}
                className="flex-1 h-14 bg-[#0F4A38] border border-[#1C6B52] rounded-2xl px-4 text-[#FFF6E3] focus:outline-none focus:border-[#FFD166]/60 transition-colors"
              />
              <input
                type="time"
                value={unlockTime}
                onChange={e => setUnlockTime(e.target.value)}
                className="w-36 h-14 bg-[#0F4A38] border border-[#1C6B52] rounded-2xl px-4 text-[#FFF6E3] focus:outline-none focus:border-[#FFD166]/60 transition-colors"
              />
            </div>
            <p className="text-[#FFF6E3]/40 text-xs mt-1">Pot unlocks up to 90 days from now.</p>
          </motion.div>
        )}
      </AnimatePresence>

      {error && (
        <div className="mb-4 p-3 bg-[#FF6B5A]/10 border border-[#FF6B5A]/30 rounded-2xl text-[#FF6B5A] text-sm">
          {error}
        </div>
      )}

      {wrongChain ? (
        <button
          onClick={() => switchChain({ chainId: ARC_CHAIN_ID })}
          disabled={isSwitching}
          className="w-full h-16 rounded-2xl bg-gradient-to-r from-[#FFD166] to-[#F5A623] text-[#1A1405] font-bold text-lg disabled:opacity-50 transition-all active:scale-95"
        >
          {isSwitching ? 'Switching…' : 'Switch to Arc'}
        </button>
      ) : !isConnected ? (
        <div className="flex justify-center">
          <ConnectKitButton label="Connect Wallet to Create" />
        </div>
      ) : (
        <button
          onClick={() => { void handleCreate() }}
          disabled={step !== 'idle'}
          className="w-full h-16 rounded-2xl bg-gradient-to-r from-[#FFD166] to-[#F5A623] text-[#1A1405] font-bold text-lg disabled:opacity-50 transition-all active:scale-95 flex items-center justify-center gap-2"
        >
          {step === 'creating' ? (
            <>
              <span className="w-5 h-5 border-2 border-[#1A1405]/30 border-t-[#1A1405] rounded-full animate-spin" />
              Creating event…
            </>
          ) : (
            <>Create Event <ArrowRight size={20} /></>
          )}
        </button>
      )}
    </div>
  )
}

function CreateSuccess({ name, mode, eventId, blockNumber, loading }: {
  name: string; mode: string; eventId: number | null; blockNumber: bigint | null; loading: boolean
}) {
  const base = typeof window !== 'undefined' ? window.location.origin : ''
  const blockSuffix = blockNumber !== null && blockNumber > 0n ? `?b=${blockNumber.toString()}` : ''
  const guestUrl = eventId !== null ? `${base}/e/${eventId}${blockSuffix}` : null
  const wallUrl  = eventId !== null ? `${base}/wall/${eventId}${blockSuffix}` : null

  return (
    <div className="min-h-dvh px-4 pt-16 pb-20 max-w-md mx-auto flex flex-col items-center text-center">
      <motion.div initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 280, damping: 22 }}>
        <SprayLogo size={64} />
      </motion.div>
      <h1 className="font-display font-bold text-[#FFD166] text-3xl mt-5 mb-1">{name}</h1>
      <p className="text-[#7CF2C2] font-semibold mb-1">Event created!</p>
      <p className="text-[#FFF6E3]/50 text-sm mb-8">
        {mode === 'LIVE' ? 'Sprays credit recipients immediately.' : 'All sprays are held until unlock time.'}
      </p>

      {loading ? (
        <div className="flex flex-col items-center gap-3">
          <span className="w-8 h-8 border-2 border-[#FFD166]/30 border-t-[#FFD166] rounded-full animate-spin" />
          <p className="text-[#FFF6E3]/50 text-sm">Reading event ID from chain…</p>
        </div>
      ) : eventId !== null ? (
        <div className="w-full space-y-4">
          {/* QR code */}
          {guestUrl && (
            <div className="flex justify-center">
              <div className="bg-white rounded-3xl p-4 shadow-lg">
                <QRCodeSVG value={guestUrl} size={180} bgColor="#ffffff" fgColor="#06261C" level="M" />
              </div>
            </div>
          )}

          {/* Guest link */}
          <div className="bg-[#0F4A38] border border-[#1C6B52] rounded-2xl p-4">
            <p className="text-[#FFF6E3]/50 text-xs font-medium uppercase tracking-wider mb-2">Guest Link</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-[#FFD166] text-sm font-mono break-all text-left">{guestUrl}</code>
              <CopyBtn text={guestUrl!} />
              <a href={guestUrl!} target="_blank" rel="noopener noreferrer" className="p-2 rounded-xl hover:bg-[#1C6B52] transition-colors">
                <ExternalLink size={15} className="text-[#FFF6E3]/50" />
              </a>
            </div>
          </div>

          {/* Wall link */}
          <div className="bg-[#0F4A38] border border-[#1C6B52] rounded-2xl p-4">
            <p className="text-[#FFF6E3]/50 text-xs font-medium uppercase tracking-wider mb-2">Wall / Projector</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-[#7CF2C2] text-sm font-mono break-all text-left">{wallUrl}</code>
              <CopyBtn text={wallUrl!} />
              <a href={wallUrl!} target="_blank" rel="noopener noreferrer" className="p-2 rounded-xl hover:bg-[#1C6B52] transition-colors">
                <ExternalLink size={15} className="text-[#FFF6E3]/50" />
              </a>
            </div>
          </div>

          <p className="text-[#FFF6E3]/30 text-xs">Event #{eventId} · Arc</p>
        </div>
      ) : (
        // Fallback if log decode failed
        <div className="w-full bg-[#0F4A38] border border-[#1C6B52] rounded-3xl p-5 text-left space-y-2">
          <p className="text-[#FFF6E3]/60 text-sm">Event created on-chain. Share these links after looking up your event ID:</p>
          <code className="block text-[#FFD166] text-sm font-mono break-all">{base}/e/&lt;eventId&gt;</code>
          <code className="block text-[#7CF2C2] text-sm font-mono break-all">{base}/wall/&lt;eventId&gt;</code>
          <p className="text-[#FFF6E3]/30 text-xs">Find the event ID in the EventCreated log (first indexed topic).</p>
        </div>
      )}
    </div>
  )
}
