interface LogoProps {
  size?: number
  className?: string
}

// The Kabooly wave mark in its three brand blues, as on kabooly.com.
export default function Logo({ size = 32, className }: LogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="none"
      role="img"
      aria-label="Kabooly"
      className={className}
    >
      <path d="M32 160 Q128 64 256 160 T480 160" stroke="#1e40af" strokeWidth="48" strokeLinecap="round" />
      <path d="M32 272 Q128 176 256 272 T480 272" stroke="#2563eb" strokeWidth="48" strokeLinecap="round" />
      <path d="M32 384 Q128 288 256 384 T480 384" stroke="#3b82f6" strokeWidth="48" strokeLinecap="round" />
    </svg>
  )
}
