import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = {
  children?: ReactNode
  /** Label yang tampil di layar error, mis. "Admin Dashboard". */
  label?: string
}

type State = {
  error: Error | null
  info: string | null
}

/**
 * Penangkap error render-time.
 *
 * Tanpa boundary, satu error di subtreeMana pun membuat seluruh React tree
 * unmount -> layar putih kosong (blank screen) dan pengguna tidak punya
 * jalan lain selain reload aplikasi. Boundary ini memotong kegagalan di
 * satu area dan menampilkan tombol "Coba Lagi" supaya aplikasi tetap bisa
 * dipakai tanpa kehilangan state di luar area yang gagal.
 *
 * Error Boundary hanya menangkap error saat RENDER/ lifecycle — bukan error
 * di dalam callback async (promise). Untuk itu tetap perlu try-catch di
 * fungsi async masing-masing.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, info: null }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Simpan component stack untuk diagnosa lewat Supabase Logs / console.
    console.error('[ErrorBoundary]', this.props.label ?? 'app', error, info.componentStack)
    this.setState({ info: info.componentStack ?? null })
  }

  handleRetry = (): void => {
    this.setState({ error: null, info: null })
  }

  override render(): ReactNode {
    const { error, info } = this.state
    if (!error) return this.props.children

    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 p-6">
        <div className="max-w-lg w-full bg-white rounded-2xl border border-red-200 shadow-sm p-6">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 shrink-0 rounded-full bg-red-50 flex items-center justify-center">
              <span className="text-red-500 text-xl font-black">!</span>
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-slate-900">
                {this.props.label ?? 'Aplikasi'} gagal ditampilkan
              </h2>
              <p className="text-[13px] text-slate-500 mt-1">
                Ada kesalahan saat memproses tampilan. Data di server tidak hilang — kamu bisa
                mencoba memuat ulang bagian ini.
              </p>
            </div>
          </div>

          <pre className="mt-4 max-h-40 overflow-auto rounded-xl bg-slate-900 text-slate-200 text-[11px] p-3 whitespace-pre-wrap break-words">
            {error.message}
            {info ? `\n${info}` : ''}
          </pre>

          <div className="mt-4 flex gap-3">
            <button
              onClick={this.handleRetry}
              className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white font-semibold text-sm hover:bg-blue-700"
            >
              Coba Lagi
            </button>
            <button
              onClick={() => { window.location.reload() }}
              className="flex-1 py-2.5 rounded-xl border border-slate-300 text-slate-700 font-semibold text-sm hover:bg-slate-50"
            >
              Muat Ulang Aplikasi
            </button>
          </div>
        </div>
      </div>
    )
  }
}

export default ErrorBoundary
