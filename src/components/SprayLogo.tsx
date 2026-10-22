export function SprayLogo({ size = 32 }: { size?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width={size} height={size}>
      <defs>
        <linearGradient id="spray-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#12805E"/>
          <stop offset="1" stopColor="#06261C"/>
        </linearGradient>
        <radialGradient id="spray-glow" cx="50%" cy="78%" r="55%">
          <stop offset="0" stopColor="#3DDC97" stopOpacity=".34"/>
          <stop offset="1" stopColor="#3DDC97" stopOpacity="0"/>
        </radialGradient>
        <linearGradient id="spray-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFE08A"/>
          <stop offset="1" stopColor="#F5A623"/>
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="116" fill="url(#spray-bg)"/>
      <rect width="512" height="512" rx="116" fill="url(#spray-glow)"/>
      <g transform="rotate(-27 256 372)">
        <rect x="194" y="172" width="124" height="200" rx="22" fill="#FFF6E3"/>
        <rect x="206" y="184" width="100" height="176" rx="14" fill="none" stroke="#0A3A2B" strokeOpacity=".22" strokeWidth="3"/>
      </g>
      <g transform="rotate(27 256 372)">
        <rect x="194" y="172" width="124" height="200" rx="22" fill="#7CF2C2"/>
        <rect x="206" y="184" width="100" height="176" rx="14" fill="none" stroke="#0A3A2B" strokeOpacity=".22" strokeWidth="3"/>
      </g>
      <g transform="rotate(0 256 372)">
        <rect x="194" y="172" width="124" height="200" rx="22" fill="url(#spray-gold)"/>
        <rect x="206" y="184" width="100" height="176" rx="14" fill="none" stroke="#0A3A2B" strokeOpacity=".22" strokeWidth="3"/>
        <g transform="translate(256 262)" stroke="#0A3A2B" strokeLinecap="round" strokeLinejoin="round" fill="none">
          <path d="M-17 26 V-26 L17 26 V-26" strokeWidth="11"/>
          <path d="M-27 -7 H27 M-27 9 H27" strokeWidth="6"/>
        </g>
      </g>
      <circle cx="82.9" cy="280.0" r="9" fill="#FFD166"/>
      <circle cx="106.1" cy="205.5" r="6" fill="#FFF6E3"/>
      <circle cx="179.3" cy="172.2" r="11" fill="#7CF2C2"/>
      <circle cx="256.0" cy="136.0" r="7" fill="#FFD166"/>
      <circle cx="332.7" cy="172.2" r="9" fill="#FFF6E3"/>
      <circle cx="405.9" cy="205.5" r="12" fill="#7CF2C2"/>
      <circle cx="429.1" cy="280.0" r="7" fill="#FFD166"/>
      <circle cx="256" cy="372" r="15" fill="#06261C"/>
      <circle cx="256" cy="372" r="7" fill="#FFD166"/>
    </svg>
  )
}
