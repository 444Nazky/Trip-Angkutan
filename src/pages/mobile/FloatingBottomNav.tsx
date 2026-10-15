import { useState, useCallback, useEffect } from 'react'
import { Home, List, User, X } from 'lucide-react'
import type { ElementType } from 'react'




export interface FloatingBottomNavProps {
  activeScreen: string
  onNavigate: (screen: string) => void
}




interface NavItem {
  id: string
  label: string
  icon: ElementType
}

const navItems: NavItem[] = [
  { id: 'home', label: 'Beranda', icon: Home },
  { id: 'history', label: 'Riwayat', icon: List },
  { id: 'profile', label: 'Profil', icon: User },
]




interface NavConfirmDialog {
  isOpen: boolean
  message: string
  pendingAction: (() => void) | null
  countdown: number
}




export default function FloatingBottomNav({ activeScreen, onNavigate }: FloatingBottomNavProps) {
  const [confirmDialog, setConfirmDialog] = useState<NavConfirmDialog>({
    isOpen: false,
    message: '',
    pendingAction: null,
    countdown: 0,
  })

  const openConfirmDialog = useCallback((message: string, action: () => void) => {
    setConfirmDialog({
      isOpen: true,
      message,
      pendingAction: action,
      countdown: 3,
    })
  }, [])

  const closeConfirmDialog = useCallback(() => {
    setConfirmDialog({ isOpen: false, message: '', pendingAction: null, countdown: 0 })
  }, [])

  const executeConfirm = useCallback(() => {
    if (confirmDialog.pendingAction) {
      confirmDialog.pendingAction()
    }
    closeConfirmDialog()
  }, [confirmDialog.pendingAction, closeConfirmDialog])

  useEffect(() => {
    if (!confirmDialog.isOpen || confirmDialog.countdown <= 0) return
    const timer = window.setInterval(() => {
      setConfirmDialog(prev => {
        if (prev.countdown <= 1) {
          clearInterval(timer)
          return { ...prev, countdown: 0 }
        }
        return { ...prev, countdown: prev.countdown - 1 }
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [confirmDialog.isOpen, confirmDialog.countdown])

  const handleNavClick = (id: string) => {
    if (activeScreen === 'trip-summary') {
      const label = id === 'home' ? 'Beranda' : id === 'history' ? 'Riwayat' : 'Profil'
      openConfirmDialog(`Apakah Anda yakin ingin ke ${label}? Data trip belum disimpan.`, () => onNavigate(id))
    } else {
      onNavigate(id)
    }
  }

  return (
    <>
      <div className="shrink-0 px-4 pb-7 pt-2">
        <nav className="bg-white rounded-2xl shadow-lg border border-slate-100 flex justify-around items-center py-3 px-2">
          {navItems.map(({ id, label, icon: Icon }) => {
            const isActive = activeScreen === id
            return (
              <button
                key={id}
                onClick={() => handleNavClick(id)}
                className={`flex flex-col items-center gap-1 px-6 py-1.5 rounded-2xl transition-all active:scale-95 ${
                  isActive ? 'text-blue-600 font-semibold bg-blue-50' : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                <Icon size={20} strokeWidth={isActive ? 2.5 : 1.8} />
                <span className="text-[10px]">{label}</span>
              </button>
            )
          })}
        </nav>
      </div>

      {/* Navigation Confirmation Dialog */}
      {confirmDialog.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-xs rounded-2xl bg-white p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">Konfirmasi</h3>
              <button
                onClick={closeConfirmDialog}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition-colors hover:bg-slate-200"
              >
                <X size={16} />
              </button>
            </div>
            <p className="mb-5 text-sm text-slate-600">{confirmDialog.message}</p>
            <div className="flex gap-2">
              <button
                onClick={closeConfirmDialog}
                className="flex-1 rounded-xl border border-slate-200 bg-transparent py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50"
              >
                Batal
              </button>
              <button
                onClick={executeConfirm}
                disabled={confirmDialog.countdown > 0}
                className={`flex-1 rounded-xl py-2.5 text-sm font-semibold text-white transition-all ${
                  confirmDialog.countdown > 0
                    ? 'bg-slate-300 cursor-not-allowed'
                    : 'bg-blue-600 hover:bg-blue-700 active:scale-[0.98]'
                }`}
              >
                {confirmDialog.countdown > 0 ? `Yakin (${confirmDialog.countdown})` : 'Yakin'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
