import { useReadContract } from 'wagmi'
import { SPRAY_CONTRACT, ARC_CHAIN_ID, type SprayEvent } from '../contract'

export function useSprayEvent(eventId: number | undefined) {
  const { data, isLoading, error, refetch } = useReadContract({
    ...SPRAY_CONTRACT,
    functionName: 'getEvent',
    args: eventId !== undefined ? [BigInt(eventId)] : undefined,
    chainId: ARC_CHAIN_ID,
    query: {
      enabled: eventId !== undefined,
      refetchInterval: 6000,
    },
  })

  return {
    event: data as SprayEvent | undefined,
    isLoading,
    error,
    refetch,
  }
}

export function useRecipientBalance(address: string | undefined) {
  const { data, isLoading, refetch } = useReadContract({
    ...SPRAY_CONTRACT,
    functionName: 'balance',
    args: address ? [address as `0x${string}`] : undefined,
    chainId: ARC_CHAIN_ID,
    query: {
      enabled: !!address,
      refetchInterval: 6000,
    },
  })

  return { balance: data as bigint | undefined, isLoading, refetch }
}

export function useContribution(eventId: number | undefined, address: string | undefined) {
  const { data, isLoading, refetch } = useReadContract({
    ...SPRAY_CONTRACT,
    functionName: 'getContribution',
    args: eventId !== undefined && address ? [BigInt(eventId), address as `0x${string}`] : undefined,
    chainId: ARC_CHAIN_ID,
    query: {
      enabled: eventId !== undefined && !!address,
      refetchInterval: 6000,
    },
  })

  return { contribution: data as bigint | undefined, isLoading, refetch }
}

export function useNextEventId() {
  const { data } = useReadContract({
    ...SPRAY_CONTRACT,
    functionName: 'nextEventId',
    chainId: ARC_CHAIN_ID,
    query: { refetchInterval: 10000 },
  })
  return data as bigint | undefined
}
