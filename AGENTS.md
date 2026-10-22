# Spray — Digital Owambe Spray App

> Built with Arc Studio - money-powered apps in minutes

This is the **project memory** - what Arc Studio remembers about building this app. It helps future agents (or humans) understand and extend the project.

---

## What This App Does

Spray is a digital owambe (Nigerian party) spray app where guests send USDC to event recipients. Two modes: LIVE (instant credit per spray) and POT (escrow until a future date, then settle). Mobile-first, warm celebratory design.

## Deployed Contract

### Mainnet (current)
- **Contract**: Spray.sol
- **Address**: 0xbba7805fc33ce405274227776e712bdbd555401c
- **Chain**: Arc Mainnet (Chain ID: 5042)
- **Deploy Block**: 27,024,769
- **USDC**: 0x3600000000000000000000000000000000000000
- **Explorer**: https://explorer.arc.io/address/0xbba7805fc33ce405274227776e712bdbd555401c
- **Deployed**: 2026-10-21 (v2 — EventNotFound, InvalidRate validation)

### Testnet (retired)
- **Address**: 0xe1c8bef0ee243062e169b26d68f440f7d69c7fe7 (v2, Arc Testnet 5042002)
- **Address**: 0xe97a64a69599a014ac27c549fb081408d842d6bd (v1, Arc Testnet 5042002)

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS
- Web3: wagmi v2, viem v2, ConnectKit
- Contracts: Solidity 0.8.28 + Foundry. Sources in `contracts/`, unit tests in `contracts/test/*.t.sol`. Build with `bun run contracts:build` (`forge build`), test with `bun run contracts:test` (`forge test`).
- Wallet: injected (MetaMask, etc.)
- Chain: Arc Testnet (Chain ID: 5042002, imported from `viem/chains`)
- Token: USDC (6 decimals) (Address: 0x3600000000000000000000000000000000000000, Chain: Arc Testnet)
- Toasts: Sonner

## Key Files

- `src/App.tsx` - Main application logic
- `src/components/` - UI components
- `src/config.ts` - wagmi config (chains, connectors, transports)

## To Run

```bash
bun install
bun run dev
```
