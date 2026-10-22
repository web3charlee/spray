import { useState, useEffect } from 'react'
import { formatCountdown } from '../utils/format'

interface CountdownProps {
  targetTs: number // unix seconds
  onExpired?: () => void
  large?: boolean
}

export function Countdown({ targetTs, onExpired, large }: CountdownProps) {
  const [display, setDisplay] = useState(() => formatCountdown(targetTs))
  const [expired, setExpired] = useState(false)

  useEffect(() => {
    const tick = () => {
      const str = formatCountdown(targetTs)
      setDisplay(str)
      if (str === 'Unlocked' && !expired) {
        setExpired(true)
        onExpired?.()
      }
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [targetTs, onExpired, expired])

  if (expired) {
    return (
      <span
        className={`font-display font-bold text-[#7CF2C2] tabular-nums ${large ? 'text-3xl' : 'text-lg'}`}
      >
        Pot Unlocked
      </span>
    )
  }

  return (
    <span
      className={`font-display font-bold text-[#FFD166] tabular-nums ${large ? 'text-3xl' : 'text-lg'}`}
    >
      {display}
    </span>
  )
}
