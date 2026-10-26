import type { JSX } from 'react'
import { APP_NAME } from '../../../shared/types'

interface LogoProps {
  compact?: boolean
}

export function Logo({ compact = false }: LogoProps): JSX.Element {
  return (
    <div className={`brand ${compact ? 'brand--compact' : ''}`}>
      <span className="brand__mark" aria-hidden="true">
        <svg viewBox="0 0 48 48" fill="none">
          <rect width="48" height="48" rx="13" fill="url(#brand-gradient)" />
          <path
            d="M12 14.5A2.5 2.5 0 0 1 14.5 12h10.3c1.3 0 2.5.5 3.4 1.4l2.4 2.4c.9.9 1.4 2.1 1.4 3.4V36H14.5a2.5 2.5 0 0 1-2.5-2.5z"
            fill="#fff"
          />
          <path d="M28 12v8h8" fill="var(--primary-soft)" />
          <path
            d="M17 23h12M17 28h12M17 33h7"
            stroke="var(--primary-strong)"
            strokeWidth="2.2"
            strokeLinecap="round"
            opacity=".9"
          />
          <circle
            cx="35.5"
            cy="35.5"
            r="7.5"
            fill="var(--accent)"
            stroke="var(--sidebar)"
            strokeWidth="1.8"
          />
          <path
            d="M35.5 31.5v6m0 0-3-3m3 3 3-3"
            stroke="var(--primary-contrast)"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <defs>
            <linearGradient id="brand-gradient" x1="4" y1="2" x2="44" y2="46">
              <stop stopColor="var(--primary)" />
              <stop offset="1" stopColor="var(--primary-strong)" />
            </linearGradient>
          </defs>
        </svg>
      </span>
      {!compact && (
        <span className="brand__copy">
          <strong>{APP_NAME}</strong>
          <span>Materiali UniPD in Obsidian</span>
        </span>
      )}
    </div>
  )
}
