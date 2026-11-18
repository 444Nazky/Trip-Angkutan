import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface MobileModalProps {
  open: boolean
  onClose?: () => void
  children: ReactNode
  panelClassName: string
  overlayClassName?: string
  closeOnBackdrop?: boolean
  labelledBy?: string
}

/**
 * Dialog mobile yang selalu berada di tengah VIEWPORT.
 *
 * `position: fixed` saja tidak cukup: layar mobile memakai animasi transform
 * (`scr-anim`), sehingga dialog yang dirender di dalam halaman ikut dipusatkan
 * terhadap tinggi halaman — bukan layar. Akibatnya petugas harus menggulir
 * dulu untuk melihat popup. Portal memindahkan dialog ke <body>, di luar
 * konteks transform halaman.
 */
export default function MobileModal({
  open,
  onClose,
  children,
  panelClassName,
  overlayClassName = 'bg-black/50',
  closeOnBackdrop = true,
  labelledBy,
}: MobileModalProps) {
  useEffect(() => {
    if (!open || typeof document === 'undefined') return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [open])

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center p-4 ${overlayClassName}`}
      style={{ position: 'fixed', inset: 0 }}
      onMouseDown={(event) => {
        if (!closeOnBackdrop) return
        if (event.target === event.currentTarget) onClose?.()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={`max-h-[calc(100dvh-2rem)] w-full overflow-y-auto ${panelClassName}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}
