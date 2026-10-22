import { useState } from 'react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useSwitchChain } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { ExternalLink } from 'lucide-react'
import { SprayLogo } from '../components/SprayLogo'
import { useSprayEvent } from '../hooks/useSprayEvent'
import { SPRAY_CONTRACT, ARC_CHAIN_ID, SprayMode, EventStatus } from '../contract'
import { formatUsdc } from '../utils/format'
import { parseOnchainError } from '../utils/onchainError'
import { buildTxExplorerUrl } from '../onchain-facts'

function EventActions({ eventId, address }: { eventId: number; address: string }) {
  const { event, refetch } = useSprayEvent(eventId)
  const [closeStep, setCloseStep] = useState<'idle' | 'closing' | 'done'>('idle')
  const [cancelStep, setCancelStep] = useState<'idle' | 'cancelling' | 'done'>('idle')
  const [error, setError] = useState('')
  const { writeContractAsync } = useWriteContract()
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>()
  useWaitForTransactionReceipt({ hash: txHash })

  const [renderNow] = useState(() => Math.floor(Date.now() / 1000))

  if (!event) return <div className="text-[#FFF6E3]/40 text-sm">Loading...</div>

  const isHost = event.host.toLowerCase() === address.toLowerCase()
  const isOpen = event.status === EventStatus.OPEN
  const isLive = event.mode === SprayMode.LIVE
  const isPOT = event.mode === SprayMode.POT
  const unlockTs = Number(event.unlockAt)
  const beforeUnlock = isPOT && renderNow < unlockTs

  if (!isHost) {
    return <p className="text-[#FFF6E3]/50 text-sm">You are not the host of event #{eventId}.</p>
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-between text-sm">
        <span className="text-[#FFF6E3]/60">{event.name}</span>
        <span className="text-[#FFD166] tabular-nums">${formatUsdc(event.totalSprayed)} sprayed</span>
      </div>
      <div className="flex gap-2 flex-wrap">
        {isOpen && isLive && (closeStep !== 'done') && (
          <button
            onClick={() => void (async () => {
              setError('')
              try {
                setCloseStep('closing')
                const hash = await writeContractAsync({
                  ...SPRAY_CONTRACT,
                  functionName: 'closeEvent',
                  args: [BigInt(eventId)],
                })
                setTxHash(hash)
                setCloseStep('done')
                void refetch()
              } catch (e) { setCloseStep('idle'); setError(parseOnchainError(e)) }
            })()}
            disabled={closeStep !== 'idle'}
            className="h-10 px-4 rounded-xl bg-[#1C6B52] hover:bg-[#246057] text-[#FFF6E3] text-sm font-medium disabled:opacity-50 transition-colors"
          >
            {closeStep === 'closing' ? 'Closing...' : 'Close Event'}
          </button>
        )}
        {isOpen && isPOT && beforeUnlock && (cancelStep !== 'done') && (
          <button
            onClick={() => void (async () => {
              setError('')
              if (!confirm('Cancel this pot? All contributors will be able to refund.')) return
              try {
                setCancelStep('cancelling')
                const hash = await writeContractAsync({
                  ...SPRAY_CONTRACT,
                  functionName: 'cancelEvent',
                  args: [BigInt(eventId)],
                })
                setTxHash(hash)
                setCancelStep('done')
                void refetch()
              } catch (e) { setCancelStep('idle'); setError(parseOnchainError(e)) }
            })()}
            disabled={cancelStep !== 'idle'}
            className="h-10 px-4 rounded-xl bg-[#FF6B5A]/20 hover:bg-[#FF6B5A]/30 text-[#FF6B5A] text-sm font-medium disabled:opacity-50 transition-colors"
          >
            {cancelStep === 'cancelling' ? 'Cancelling...' : 'Cancel Pot'}
          </button>
        )}
        {txHash && (
          <a
            href={buildTxExplorerUrl(ARC_CHAIN_ID, txHash)}
            target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1 h-10 px-3 rounded-xl border border-[#1C6B52] text-[#FFF6E3]/60 text-sm hover:text-[#FFF6E3] transition-colors"
          >
            Tx <ExternalLink size={12} />
          </a>
        )}
      </div>
      {error && <p className="text-[#FF6B5A] text-xs">{error}</p>}
      {(closeStep === 'done' || cancelStep === 'done') && (
        <p className="text-[#7CF2C2] text-xs">Done!</p>
      )}
    </div>
  )
}

export default function HostPage() {
  const { address, isConnected, chainId } = useAccount()
  const { switchChain, isPending: isSwitching } = useSwitchChain()
  const [eventIds, setEventIds] = useState('')

  const wrongChain = isConnected && chainId !== ARC_CHAIN_ID

  const parsedIds = eventIds
    .split(',')
    .map(s => parseInt(s.trim()))
    .filter(n => !isNaN(n) && n >= 0)

  return (
    <div className="min-h-dvh px-4 pt-6 pb-20 max-w-md mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-2">
          <SprayLogo size={28} />
          <span className="font-display font-bold text-[#FFD166] text-xl tracking-tight">Spray</span>
        </div>
        <ConnectKitButton />
      </div>

      <h1 className="font-display font-bold text-[#FFF6E3] text-3xl mb-1 tracking-tight">
        Host Tools
      </h1>
      <p className="text-[#FFF6E3]/60 text-sm mb-8">Close Live events or cancel Pot events.</p>

      {!isConnected ? (
        <div className="bg-[#0F4A38] border border-[#1C6B52] rounded-3xl p-8 text-center">
          <p className="text-[#FFF6E3]/60 mb-4">Connect your wallet to manage your events.</p>
          <ConnectKitButton />
        </div>
      ) : wrongChain ? (
        <button
          onClick={() => switchChain({ chainId: ARC_CHAIN_ID })}
          disabled={isSwitching}
          className="w-full h-16 rounded-2xl bg-gradient-to-r from-[#FFD166] to-[#F5A623] text-[#1A1405] font-bold text-lg disabled:opacity-50 transition-all active:scale-95"
        >
          {isSwitching ? 'Switching...' : 'Switch to Arc'}
        </button>
      ) : (
        <div className="bg-[#0F4A38] border border-[#1C6B52] rounded-3xl p-5">
          <input
            type="text"
            placeholder="Event IDs (comma-separated, e.g. 0, 1)"
            value={eventIds}
            onChange={e => setEventIds(e.target.value)}
            className="w-full h-12 bg-[#06261C] border border-[#1C6B52] rounded-xl px-3 text-[#FFF6E3] text-sm placeholder-[#FFF6E3]/30 focus:outline-none focus:border-[#FFD166]/60 transition-colors mb-4"
          />
          {parsedIds.length > 0 && address && (
            <div className="space-y-4">
              {parsedIds.map(eid => (
                <div key={eid} className="p-4 bg-[#06261C] rounded-2xl">
                  <p className="text-[#FFF6E3]/50 text-xs mb-2">Event #{eid}</p>
                  <EventActions eventId={eid} address={address} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
