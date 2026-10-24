import type { JSX } from 'react'
import { useAppStore } from '../store'
import { AlertIcon, CheckIcon, CloseIcon, InfoIcon } from './Icons'

export function Notice(): JSX.Element | null {
  const notice = useAppStore((state) => state.notice)
  const dismiss = useAppStore((state) => state.dismissNotice)
  if (!notice) {
    return null
  }
  const Icon =
    notice.kind === 'success' ? CheckIcon : notice.kind === 'error' ? AlertIcon : InfoIcon
  return (
    <div
      className={`notice notice--${notice.kind}`}
      role={notice.kind === 'error' ? 'alert' : 'status'}
    >
      <span className="notice__icon">
        <Icon />
      </span>
      <span className="notice__message">{notice.message}</span>
      <button
        type="button"
        className="icon-button notice__close"
        onClick={dismiss}
        aria-label="Chiudi notifica"
      >
        <CloseIcon />
      </button>
    </div>
  )
}
