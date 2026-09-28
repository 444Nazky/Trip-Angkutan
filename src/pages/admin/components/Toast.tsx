import { ChevronDown, Check, X } from 'lucide-react'
import type { Toast } from './types'

export interface ToastProps {
  toast: Toast | null
}

export function Toast({ toast }: ToastProps) {
  if (!toast) return null
  return (
    <div className={`fixed top-4 right-4 z-[100] px-4 py-3 rounded-xl shadow-lg text-sm font-medium flex items-center gap-2 transition-all ${
      toast.type === 'success' ? 'bg-blue-600 text-white' : 'bg-red-500 text-white'
    }`}>
      {toast.type === 'success' ? <Check size={16} /> : <X size={16} />}
      {toast.msg}
    </div>
  )
}

export function useToast() {
  const showToast = (setToast: (t: Toast | null) => void) => (msg: string, type: Toast['type'] = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }
  return showToast
}

export { ChevronDown }
