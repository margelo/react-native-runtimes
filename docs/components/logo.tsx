import type { SVGProps } from 'react';

export function Logo({
  size = 28,
  ...props
}: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      {...props}
    >
      <defs>
        <linearGradient id="rnr-core" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#22d3ee" />
          <stop offset="100%" stopColor="#a78bfa" />
        </linearGradient>
        <radialGradient id="rnr-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#a78bfa" stopOpacity="0" />
        </radialGradient>
      </defs>

      <circle cx="24" cy="24" r="22" fill="url(#rnr-glow)" />

      <g
        stroke="currentColor"
        strokeOpacity="0.55"
        strokeWidth="1.5"
        fill="none"
      >
        <g transform="rotate(0 24 24)">
          <ellipse cx="24" cy="24" rx="20" ry="7.5" />
          <circle cx="44" cy="24" r="3" fill="#22d3ee" stroke="none" />
        </g>
        <g transform="rotate(60 24 24)">
          <ellipse cx="24" cy="24" rx="20" ry="7.5" />
          <circle cx="44" cy="24" r="3" fill="#a78bfa" stroke="none" />
        </g>
        <g transform="rotate(120 24 24)">
          <ellipse cx="24" cy="24" rx="20" ry="7.5" />
          <circle cx="44" cy="24" r="3" fill="#f472b6" stroke="none" />
        </g>
      </g>

      <circle cx="24" cy="24" r="4.5" fill="url(#rnr-core)" />
      <circle
        cx="24"
        cy="24"
        r="4.5"
        fill="none"
        stroke="white"
        strokeOpacity="0.35"
      />
    </svg>
  );
}
