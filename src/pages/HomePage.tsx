import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRight, Zap, Lock, Users } from 'lucide-react'
import { SprayLogo } from '../components/SprayLogo'

// Stable random positions for falling notes — computed once at module load
const NOTES = Array.from({ length: 18 }, (_, i) => ({
  left: `${5 + (i * 5.5) % 92}%`,
  delay: (i * 0.37) % 3.2,
  dur: 3.5 + (i * 0.19) % 2.5,
  char: ['♩', '♪', '♫', '♬', '₦'][i % 5],
  color: ['#FFD166', '#7CF2C2', '#FFF6E3', '#F5A623', '#FFD166'][i % 5],
  size: 12 + (i % 3) * 4,
}))

const CHIPS = [
  { icon: Zap, label: 'Live Spray', desc: 'Instant credits' },
  { icon: Lock, label: 'Pot Mode', desc: 'Locked until unlock' },
  { icon: Users, label: '10 Recipients', desc: 'Split the rain' },
]

export default function HomePage() {
  const navigate = useNavigate()

  return (
    <div className="min-h-dvh px-4 pt-8 pb-20 max-w-md mx-auto flex flex-col">
      {/* Hero */}
      <div className="relative flex-1 flex flex-col items-center justify-center text-center py-14 overflow-hidden">

        {/* Falling notes — behind everything */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden>
          {NOTES.map((n, i) => (
            <motion.span
              key={i}
              className="absolute select-none"
              style={{ left: n.left, top: '-10%', color: n.color, fontSize: n.size, opacity: 0.35 }}
              animate={{ y: ['0vh', '120vh'], rotate: [0, 25, -15, 20], opacity: [0, 0.5, 0.4, 0] }}
              transition={{ duration: n.dur, delay: n.delay, repeat: Infinity, ease: 'linear' }}
            >
              {n.char}
            </motion.span>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 20 }}
          className="relative z-10"
        >
          <SprayLogo size={96} />
        </motion.div>

        <motion.h1
          className="relative z-10 font-display font-extrabold text-[#FFF6E3] mt-5 mb-2 tracking-tight"
          style={{ fontSize: 'clamp(3rem, 14vw, 4.5rem)', lineHeight: 1.05 }}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.12, duration: 0.45 }}
        >
          Spray
        </motion.h1>

        <motion.p
          className="relative z-10 text-[#FFF6E3]/60 text-lg mb-1"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.22 }}
        >
          The digital owambe, onchain.
        </motion.p>
        <motion.p
          className="relative z-10 text-[#FFF6E3]/35 text-sm mb-10 max-w-xs"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
        >
          Send USDC at celebrations — live or locked until the big moment.
        </motion.p>

        <motion.button
          onClick={() => { void navigate('/create') }}
          className="relative z-10 spray-btn-glow w-full h-[68px] rounded-2xl bg-gradient-to-r from-[#FFD166] to-[#F5A623] text-[#1A1405] font-display font-extrabold text-2xl tracking-wide transition-all active:scale-95 flex items-center justify-center gap-2 mb-5"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.38, type: 'spring', stiffness: 240, damping: 22 }}
          whileTap={{ scale: 0.97 }}
        >
          Create Event <ArrowRight size={22} />
        </motion.button>

        <div className="relative z-10 flex gap-3 w-full">
          <button
            onClick={() => { void navigate('/recipient') }}
            className="flex-1 h-12 rounded-2xl bg-[#0F4A38] border border-[#1C6B52] text-[#FFF6E3] font-semibold text-sm hover:bg-[#1C6B52] transition-colors"
          >
            Recipient
          </button>
          <button
            onClick={() => { void navigate('/host') }}
            className="flex-1 h-12 rounded-2xl bg-[#0F4A38] border border-[#1C6B52] text-[#FFF6E3] font-semibold text-sm hover:bg-[#1C6B52] transition-colors"
          >
            Host Tools
          </button>
        </div>
      </div>

      {/* Feature chips */}
      <div className="flex gap-2 flex-wrap justify-center pb-2">
        {CHIPS.map(({ icon: Icon, label, desc }, i) => (
          <motion.div
            key={label}
            className="flex items-center gap-2 bg-[#0F4A38] border border-[#1C6B52] rounded-full px-3 py-2"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 + i * 0.07 }}
          >
            <Icon size={13} className="text-[#FFD166] flex-shrink-0" />
            <span className="text-[#FFF6E3] text-xs font-semibold">{label}</span>
            <span className="text-[#FFF6E3]/40 text-xs hidden sm:inline">· {desc}</span>
          </motion.div>
        ))}
      </div>

      <p className="text-center text-[#FFF6E3]/20 text-xs mt-5">
        Arc · USDC only · Real money — spray responsibly
      </p>
    </div>
  )
}
