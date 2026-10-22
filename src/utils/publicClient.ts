/**
 * Shared viem public client for Arc mainnet.
 * Import this instead of constructing a new client per file.
 */
import { createPublicClient, http } from 'viem'
import { arc } from 'viem/chains'

export const arcPublicClient = createPublicClient({
  chain: arc,
  transport: http('https://rpc.mainnet.arc.io'),
})
