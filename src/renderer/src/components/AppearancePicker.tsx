import type { JSX } from 'react'
import type { AccentColor, ThemeMode } from '../../../shared/types'
import { MoonIcon, SunIcon } from './Icons'

interface AppearancePickerProps {
  themeMode: ThemeMode
  accentColor: AccentColor
  disabled?: boolean
  onThemeChange: (theme: ThemeMode) => void
  onAccentChange: (accent: AccentColor) => void
}

const accents: Array<{ id: AccentColor; label: string; swatch: string }> = [
  { id: 'blue', label: 'Blu', swatch: '#b9cbed' },
  { id: 'green', label: 'Verde', swatch: '#b8d9c6' },
  { id: 'pink', label: 'Rosa', swatch: '#e4bbca' },
  { id: 'purple', label: 'Viola', swatch: '#c9bee2' },
  { id: 'orange', label: 'Pesca', swatch: '#e8c5ad' },
  { id: 'yellow', label: 'Giallo', swatch: '#e5d59f' },
  { id: 'teal', label: 'Turchese', swatch: '#afd5d3' }
]

export function AppearancePicker({
  themeMode,
  accentColor,
  disabled = false,
  onThemeChange,
  onAccentChange
}: AppearancePickerProps): JSX.Element {
  return (
    <div className="appearance-picker">
      <fieldset className="appearance-control">
        <legend>Tema</legend>
        <div className="theme-options">
          <button
            type="button"
            className={`theme-option ${themeMode === 'light' ? 'theme-option--selected' : ''}`}
            aria-pressed={themeMode === 'light'}
            disabled={disabled}
            onClick={() => onThemeChange('light')}
          >
            <SunIcon />
            <span>Chiaro</span>
          </button>
          <button
            type="button"
            className={`theme-option ${themeMode === 'dark' ? 'theme-option--selected' : ''}`}
            aria-pressed={themeMode === 'dark'}
            disabled={disabled}
            onClick={() => onThemeChange('dark')}
          >
            <MoonIcon />
            <span>Scuro</span>
          </button>
        </div>
      </fieldset>

      <fieldset className="appearance-control">
        <legend>Colore principale</legend>
        <div className="accent-options">
          {accents.map((accent) => (
            <button
              key={accent.id}
              type="button"
              className={`accent-option ${accentColor === accent.id ? 'accent-option--selected' : ''}`}
              aria-pressed={accentColor === accent.id}
              disabled={disabled}
              aria-label={accent.label}
              title={accent.label}
              onClick={() => onAccentChange(accent.id)}
            >
              <span className="accent-option__swatch" style={{ backgroundColor: accent.swatch }} />
              <span className="accent-option__label">{accent.label}</span>
            </button>
          ))}
        </div>
      </fieldset>
    </div>
  )
}
