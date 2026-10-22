/**
 * wagmi configuration
 * Built with Arc Studio — https://studio.arc.io
 */

import { http, createConfig } from 'wagmi'
import { mainnet, arc } from 'wagmi/chains'
import { injected } from 'wagmi/connectors'
import { registerChain } from './tracing'

// Pre-register chain RPC URLs so trace events show correct chain names immediately
registerChain(arc.id, arc.rpcUrls.default.http[0])

// Arc's native gas token IS USDC — the viem/chains 'arc' definition already
// sets nativeCurrency to USDC, so ConnectKit shows "USDC" without an override.
export const config = createConfig({
  chains: [arc, mainnet], // mainnet kept for ENS resolution
  connectors: [injected()],
  transports: {
    [arc.id]: http('https://rpc.mainnet.arc.io'),
    [mainnet.id]: http(), // ENS resolution uses mainnet
  },
})
