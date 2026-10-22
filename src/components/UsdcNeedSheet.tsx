import { X, ExternalLink } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

interface UsdcNeedSheetProps {
  open: boolean
  onClose: () => void
}

export function UsdcNeedSheet({ open, onClose }: UsdcNeedSheetProps) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 bg-black/60 z-40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className="fixed bottom-0 left-0 right-0 z-50 bg-[#0F4A38] border border-[#1C6B52] rounded-t-3xl p-6 pb-10 max-w-md mx-auto"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 400, damping: 36 }}
          >
            <div className="w-12 h-1 bg-[#1C6B52] rounded-full mx-auto mb-6" />
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-xl font-bold text-[#FFF6E3]">
                Need USDC on Arc?
              </h2>
              <button
                onClick={onClose}
                className="p-2 rounded-full hover:bg-[#1C6B52] transition-colors"
                aria-label="Close"
              >
                <X size={20} className="text-[#FFF6E3]/60" />
              </button>
            </div>

            <div className="space-y-4 text-[#FFF6E3]/80 text-sm leading-relaxed">
              <p>
                To spray, you need <strong className="text-[#FFD166]">USDC on Arc</strong> — a
                fast network where gas is also paid in USDC. No ETH needed.
              </p>
              <div className="bg-[#06261C] rounded-2xl p-4 space-y-3">
                <p className="font-semibold text-[#FFF6E3]">How to get USDC on Arc:</p>
                <ol className="list-decimal list-inside space-y-2">
                  <li>Connect your wallet (MetaMask or any browser wallet).</li>
                  <li>Switch to Arc — we'll prompt you automatically.</li>
                  <li>
                    Bridge USDC from another chain, or buy directly on Arc.
                    See the Arc docs for options.
                  </li>
                </ol>
              </div>
              <p className="text-[#FFF6E3]/60 text-xs">
                Arc uses real USDC. Make sure you are comfortable with the
                amount before you spray — transactions are irreversible.
              </p>
            </div>

            <a
              href="https://docs.arc.io"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-6 flex items-center justify-center gap-2 w-full h-14 rounded-2xl bg-[#1C6B52] hover:bg-[#246057] text-[#FFF6E3] font-semibold transition-colors"
            >
              Arc Docs
              <ExternalLink size={16} />
            </a>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
