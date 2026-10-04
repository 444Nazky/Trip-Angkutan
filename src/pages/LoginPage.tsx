/**
 * Stub LoginPage.tsx untuk admin build.
 * Admin tidak mengarahkan ke halaman login mobile, tapi LoginPage di-handle AdminDashboard langsung.
 */
/**
 * Stub pages/LoginPage.tsx untuk admin build (src/App.tsx root entry).
 * Admin Dashboard tidak routing kemari. */
export default function LoginPage({ onLogin }: { onLogin?: () => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100">
      <div className="bg-white p-8 rounded-xl shadow-lg text-center">
        <p className="text-slate-500">Halaman login petugas lihat <code>App.tsx</code>.</p>
        <button onClick={onLogin} className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg">Masuk</button>
      </div>
    </div>
  )
}
