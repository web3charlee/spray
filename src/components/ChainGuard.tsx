import { useAccount, useSwitchChain } from 'wagmi'
import { ARC_CHAIN_ID } from '../contract'

interface ChainGuardProps {
  children: React.ReactNode
}

export function ChainGuard({ children }: ChainGuardProps) {
  const { chainId, isConnected } = useAccount()
  const { switchChain, isPending } = useSwitchChain()

  if (!isConnected) return <>{children}</>

  if (chainId !== ARC_CHAIN_ID) {
    return (
      <div className="flex flex-col items-center gap-4 p-6 bg-[#0F4A38] border border-[#1C6B52] rounded-3xl text-center">
        <p className="text-[#FFF6E3]/80 text-sm">
          Please switch to <strong className="text-[#FFD166]">Arc</strong> to continue.
        </p>
        <button
          onClick={() => switchChain({ chainId: ARC_CHAIN_ID })}
          disabled={isPending}
          className="h-12 px-6 rounded-2xl bg-gradient-to-r from-[#FFD166] to-[#F5A623] text-[#1A1405] font-semibold disabled:opacity-50 transition-all active:scale-95"
        >
          {isPending ? 'Switching...' : 'Switch to Arc'}
        </button>
      </div>
    )
  }

  return <>{children}</>
}
