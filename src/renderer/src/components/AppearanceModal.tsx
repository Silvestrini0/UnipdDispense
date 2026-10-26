import { useState, type JSX } from 'react'
import type { AccentColor, AppSettings, ThemeMode } from '../../../shared/types'
import { useAppStore } from '../store'
import { AppearancePicker } from './AppearancePicker'
import { Logo } from './Logo'
import { Switch } from './Switch'

interface AppearanceModalProps {
  settings: AppSettings
}

export function AppearanceModal({ settings }: AppearanceModalProps): JSX.Element {
  const saving = useAppStore((state) => state.settingsSaving)
  const saveSettings = useAppStore((state) => state.saveSettings)
  const [themeMode, setThemeMode] = useState<ThemeMode>(settings.themeMode)
  const [accentColor, setAccentColor] = useState<AccentColor>(settings.accentColor)
  const [launchAtLogin, setLaunchAtLogin] = useState(settings.launchAtLogin)

  const save = (): void => {
    void saveSettings({
      themeMode,
      accentColor,
      launchAtLogin,
      personalizationCompleted: true
    })
  }

  return (
    <div className="appearance-overlay">
      <section
        className="appearance-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="appearance-title"
        aria-describedby="appearance-description"
      >
        <Logo />
        <div className="appearance-modal__heading">
          <span className="eyebrow">Il tuo spazio, come piace a te</span>
          <h2 id="appearance-title">Personalizza Unipd Dispense</h2>
          <p id="appearance-description">
            Scegli il tema, il colore e se avviare l’app in background. Potrai
            cambiare queste preferenze in qualsiasi momento dalle impostazioni.
          </p>
        </div>
        <AppearancePicker
          themeMode={themeMode}
          accentColor={accentColor}
          disabled={saving}
          onThemeChange={setThemeMode}
          onAccentChange={setAccentColor}
        />
        <div className="setting-row appearance-modal__startup-setting">
          <div>
            <strong>Avvia all’accesso in background</strong>
            <span>Apri l’app senza mostrare la finestra, nell’area di notifica.</span>
          </div>
          <Switch
            checked={launchAtLogin}
            onChange={setLaunchAtLogin}
            disabled={saving}
            label="Avvia all’accesso in background"
          />
        </div>
        <div className="appearance-modal__actions">
          <button
            type="button"
            className="button button--ghost"
            onClick={() => void saveSettings({ personalizationCompleted: true })}
            disabled={saving}
          >
            Salta per ora
          </button>
          <button type="button" className="button button--primary" onClick={save} disabled={saving}>
            {saving ? 'Salvataggio…' : 'Salva e continua'}
          </button>
        </div>
      </section>
    </div>
  )
}
