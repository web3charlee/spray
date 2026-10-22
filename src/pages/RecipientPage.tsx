import { useState } from 'react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useSwitchChain } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { motion } from 'framer-motion'
import { SprayLogo } from '../components/SprayLogo'
import { useRecipientBalance, useContribution } from '../hooks/useSprayEvent'
import { SPRAY_CONTRACT, ARC_CHAIN_ID } from '../contract'
import { formatUsdc } from '../utils/format'
import { parseOnchainError } from '../utils/onchainError'

function RefundRow({ eventId, address }: { eventId: number; address: string }) {
  const { contribution, refetch } = useContribution(eventId, address)
  const [step, setStep] = useState<'idle' | 'refunding' | 'done'>('idle')
  const [error, setError] = useState('')
  const { writeContractAsync } = useWriteContract()
  const [refundTx, setRefundTx] = useState<`0x${string}` | undefined>()
  const { isSuccess } = useWaitForTransactionReceipt({ hash: refundTx })

  if (!contribution || contribution === 0n) return null

  return (
    <div className="flex items-center justify-between py-3 border-b border-[#1C6B52]/50 last:border-0">
      <div>
        <p className="text-[#FFF6E3] text-sm font-medium">Event #{eventId}</p>
        <p className="text-[#FFF6E3]/50 text-xs tabular-nums">${formatUsdc(contribution)} available</p>
      </div>
      {isSuccess || step === 'done' ? (
        <span className="text-[#7CF2C2] text-sm font-semibold">Refunded</span>
      ) : (
        <div>
          <button
            onClick={() => void (async () => {
              setError('')
              try {
                setStep('refunding')
                const hash = await writeContractAsync({
                  ...SPRAY_CONTRACT,
                  functionName: 'refund',
                  args: [BigInt(eventId)],
                })
                setRefundTx(hash)
                setStep('done')
                void refetch()
              } catch (e) {
                setStep('idle')
                setError(parseOnchainError(e))
              }
            })()}
            disabled={step !== 'idle'}
            className="h-9 px-4 rounded-xl bg-[#1C6B52] hover:bg-[#246057] text-[#FFF6E3] text-sm font-medium disabled:opacity-50 transition-colors"
          >
            {step === 'refunding' ? 'Refunding...' : 'Refund'}
          </button>
          {error && <p className="text-[#FF6B5A] text-xs mt-1">{error}</p>}
        </div>
      )}
    </div>
  )
}

export default function RecipientPage() {
  const { address, isConnected, chainId } = useAccount()
  const { switchChain, isPending: isSwitching } = useSwitchChain()
  const { balance, isLoading: balLoading } = useRecipientBalance(address)

  const [withdrawStep, setWithdrawStep] = useState<'idle' | 'withdrawing' | 'done'>('idle')
  const [withdrawError, setWithdrawError] = useState('')
  const [refundEventId, setRefundEventId] = useState('')

  const { writeContractAsync } = useWriteContract()
  const [withdrawTx, setWithdrawTx] = useState<`0x${string}` | undefined>()
  const { isSuccess: withdrawConfirmed } = useWaitForTransactionReceipt({ hash: withdrawTx })

  const wrongChain = isConnected && chainId !== ARC_CHAIN_ID
  const hasBalance = balance !== undefined && balance > 0n

  async function handleWithdraw() {
    setWithdrawError('')
    try {
      setWithdrawStep('withdrawing')
      const hash = await writeContractAsync({
        ...SPRAY_CONTRACT,
        functionName: 'withdraw',
        args: [],
      })
      setWithdrawTx(hash)
    } catch (e) {
      setWithdrawStep('idle')
      setWithdrawError(parseOnchainError(e))
    }
  }

  const refundEventIds = refundEventId
    .split(',')
    .map(s => parseInt(s.trim()))
    .filter(n => !isNaN(n) && n >= 0)

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

      <h1 className="font-display font-bold text-[#FFF6E3] text-3xl mb-1 tracking-tight">
        Recipient
      </h1>
      <p className="text-[#FFF6E3]/60 text-sm mb-8">Withdraw your sprayed USDC.</p>

      {!isConnected ? (
        <div className="bg-[#0F4A38] border border-[#1C6B52] rounded-3xl p-8 text-center">
          <p className="text-[#FFF6E3]/60 mb-4">Connect your wallet to see your balance.</p>
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
        <>
          {/* Balance card */}
          <div className="bg-[#0F4A38] border border-[#1C6B52] rounded-3xl p-6 mb-6">
            <p className="text-[#FFF6E3]/60 text-sm mb-1">Available to Withdraw</p>
            {balLoading ? (
              <div className="w-24 h-8 bg-[#1C6B52] rounded-lg animate-pulse" />
            ) : (
              <motion.p
                key={balance?.toString()}
                className="font-display font-bold text-[#FFD166] text-4xl tabular-nums"
                initial={{ scale: 1 }}
                animate={{ scale: [1, 1.05, 1] }}
                transition={{ duration: 0.35 }}
              >
                ${formatUsdc(balance ?? 0n)}
              </motion.p>
            )}
            <p className="text-[#FFF6E3]/40 text-xs mt-1">USDC on Arc</p>
          </div>

          {withdrawConfirmed || withdrawStep === 'done' ? (
            <div className="bg-[#7CF2C2]/10 border border-[#7CF2C2]/30 rounded-2xl p-4 text-center mb-6">
              <p className="text-[#7CF2C2] font-semibold">Withdrawn! USDC is in your wallet.</p>
            </div>
          ) : (
            <div className="mb-6">
              <button
                onClick={() => { void handleWithdraw() }}
                disabled={!hasBalance || withdrawStep !== 'idle'}
                className="w-full h-16 rounded-2xl bg-gradient-to-r from-[#FFD166] to-[#F5A623] text-[#1A1405] font-bold text-xl disabled:opacity-40 transition-all active:scale-95 flex items-center justify-center gap-2"
              >
                {withdrawStep === 'withdrawing' ? (
                  <>
                    <span className="w-5 h-5 border-2 border-[#1A1405]/30 border-t-[#1A1405] rounded-full animate-spin" />
                    Withdrawing...
                  </>
                ) : (
                  hasBalance ? `Withdraw $${formatUsdc(balance ?? 0n)}` : 'Nothing to Withdraw'
                )}
              </button>
              {withdrawError && (
                <p className="text-[#FF6B5A] text-xs text-center mt-2">{withdrawError}</p>
              )}
            </div>
          )}

          {/* Refund section */}
          <div className="bg-[#0F4A38] border border-[#1C6B52] rounded-3xl p-5">
            <h2 className="font-display font-semibold text-[#FFF6E3] text-lg mb-1">Pot Refunds</h2>
            <p className="text-[#FFF6E3]/50 text-xs mb-4">
              If a Pot event was cancelled, enter the event ID(s) to claim your refund.
            </p>
            <input
              type="text"
              placeholder="Event IDs (comma-separated, e.g. 0, 3, 7)"
              value={refundEventId}
              onChange={e => setRefundEventId(e.target.value)}
              className="w-full h-12 bg-[#06261C] border border-[#1C6B52] rounded-xl px-3 text-[#FFF6E3] text-sm placeholder-[#FFF6E3]/30 focus:outline-none focus:border-[#FFD166]/60 transition-colors mb-3"
            />

            {refundEventIds.length > 0 && address && (
              <div className="divide-y divide-[#1C6B52]/50">
                {refundEventIds.map(eid => (
                  <RefundRow key={eid} eventId={eid} address={address} />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
