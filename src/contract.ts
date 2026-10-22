import artifact from '../contracts/out/Spray.sol/Spray.json'

export const SPRAY_ADDRESS = '0xbba7805fc33ce405274227776e712bdbd555401c' as const
// Block at which the Spray contract was deployed on Arc mainnet — getLogs start point.
export const SPRAY_DEPLOY_BLOCK = 27_024_769n
// Arc mainnet RPC — probe showed 2 000 blocks per getLogs call is safe.
// If a chunk call fails the hook reduces chunk size automatically and retries.
export const LOG_CHUNK_SIZE = 2_000n

export const SPRAY_ABI = artifact.abi

export const SPRAY_CONTRACT = {
  address: SPRAY_ADDRESS,
  abi: SPRAY_ABI,
} as const

// Arc mainnet (chain ID 5042). USDC address is the same on mainnet and testnet.
export const ARC_CHAIN_ID = 5042
export const USDC_ADDRESS = '0x3600000000000000000000000000000000000000' as const
export const USDC_DECIMALS = 6

export const MIN_SPRAY = 0.10 // USDC
export const MAX_SPRAY = 20.0 // USDC
export const EVENT_CAP = 200.0 // USDC

export enum SprayMode {
  LIVE = 0,
  POT = 1,
}

export enum EventStatus {
  OPEN = 0,
  CLOSED = 1,
  CANCELLED = 2,
  SETTLED = 3,
}

export interface SprayEvent {
  name: string
  host: string
  recipients: string[]
  sharesBps: number[]
  mode: SprayMode
  status: EventStatus
  unlockAt: bigint
  ngnPerUsd: bigint
  totalSprayed: bigint
}
