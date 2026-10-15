import { useState } from 'react';




interface SideloadingHelperProps {
  variant?: 'full' | 'compact' | 'inline';
  onHelpRequested?: () => void;
}




export function SideloadingHelper({
  variant = 'full',
  onHelpRequested
}: SideloadingHelperProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (variant === 'inline') {
    return (
      <details className="sideloading-inline">
        <summary>📱 Apa itu instalasi dari sumber tidak dikenal?</summary>
        <div className="sideloading-inline__content">
          <p>
            Android memerlukan izin khusus untuk menginstal aplikasi dari luar
            Google Play Store. Ini normal untuk aplikasi internal perusahaan.
          </p>
          <ol>
            <li>Saat muncul dialog, tap <strong>"Izinkan"</strong></li>
            <li>Jika tidak ada opsi tersebut, tap <strong>"Pengaturan"</strong></li>
            <li>Aktifkan "Sumber tidak dikenal" untuk aplikasi ini</li>
            <li>Kembali dan coba lagi</li>
          </ol>
        </div>
      </details>
    );
  }

  if (variant === 'compact') {
    return (
      <button
        className="sideloading-compact"
        onClick={() => setIsOpen(true)}
      >
        💡 Butuh bantuan instalasi?
      </button>
    );
  }

  return (
    <div className="sideloading-helper">
      <button
        className="sideloading-helper__toggle"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
      >
        <span className="sideloading-helper__icon">📱</span>
        <span className="sideloading-helper__title">Panduan Instalasi APK</span>
        <span className="sideloading-helper__arrow">{isOpen ? '▲' : '▼'}</span>
      </button>

      {isOpen && (
        <div className="sideloading-helper__content">
          <section className="sideloading-section">
            <h4>⚠️ Apa yang harus saya lakukan?</h4>
            <p>
              Saat Anda menginstal update aplikasi di luar Google Play Store,
              Android akan menampilkan peringatan keamanan. Ini normal dan aman.
            </p>
          </section>

          <section className="sideloading-section">
            <h4>📋 Langkah-langkah:</h4>
            <ol className="sideloading-steps">
              <li>
                <strong>Jika ada tombol "Izinkan" atau "Tetap Izinkan":</strong>
                <p>Tap tombol tersebut. Aplikasi Trip Angkutan aman dan terpercaya.</p>
              </li>
              <li>
                <strong>Jika tidak ada tombol tersebut:</strong>
                <p>Tap tombol "Pengaturan" atau "Setelan" di dialog.</p>
                <ul>
                  <li>Anda akan diarahkan ke pengaturan keamanan</li>
                  <li>Cari "Sumber tidak dikenal" atau "Unknown sources"</li>
                  <li>Aktifkan untuk <strong>Aplikasi Trip Angkutan</strong></li>
                  <li>Kembali ke aplikasi</li>
                  <li>Tap "Update" lagi</li>
                </ul>
              </li>
              <li>
                <strong>Jika instalasi dibatalkan:</strong>
                <p>Update tidak jadi dipasang. Anda masih bisa menggunakan aplikasi versi lama.</p>
              </li>
            </ol>
          </section>

          <section className="sideloading-section sideloading-section--note">
            <h4>🔒 Tentang Keamanan</h4>
            <p>
              Aplikasi Trip Angkutan memerlukan izin ini untuk dapat memperbarui
              dirinya sendiri. Data Anda tetap aman karena:
            </p>
            <ul>
              <li>Update hanya diunduh dari server resmi kami</li>
              <li>Setiap file diverifikasi dengan hash SHA-256</li>
              <li>Update hanya berisi kode aplikasi, bukan data pribadi Anda</li>
            </ul>
          </section>

          <section className="sideloading-section">
            <h4>❓ Masih有问题?</h4>
            <p>Hubungi administrator IT Anda jika:</p>
            <ul>
              <li>Pengaturan tidak tersedia di perangkat Anda</li>
              <li>Anda tidak memiliki izin untuk mengubah pengaturan keamanan</li>
              <li>Instalasi tetap gagal setelah mengikuti langkah di atas</li>
            </ul>
          </section>

          {onHelpRequested && (
            <button
              className="sideloading-helper__contact"
              onClick={onHelpRequested}
            >
              Hubungi Bantuan
            </button>
          )}
        </div>
      )}
    </div>
  );
}




interface InstallResultHandlerProps {
  onSuccess?: () => void;
  onFailure?: (error: string) => void;
}




export function InstallResultHandler({
  onSuccess,
  onFailure
}: InstallResultHandlerProps) {

  return null;
}




interface InstallInstructionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  version: string;
}




export function InstallInstructionsModal({
  isOpen,
  onClose,
  version
}: InstallInstructionsModalProps) {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>📥 Update {version} Siap Diinstal</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          <div className="install-step">
            <span className="install-step__number">1</span>
            <div className="install-step__content">
              <h4>File APK akan terbuka</h4>
              <p>Android akan menampilkan dialog instalasi.</p>
            </div>
          </div>

          <div className="install-step">
            <span className="install-step__number">2</span>
            <div className="install-step__content">
              <h4>Izinkan instalasi</h4>
              <p>Tap "Izinkan" atau "Tetap Izinkan" saat diminta.</p>
            </div>
          </div>

          <div className="install-step">
            <span className="install-step__number">3</span>
            <div className="install-step__content">
              <h4>Tunggu instalasi selesai</h4>
              <p>Aplikasi akan otomatis terbuka setelah update terpasang.</p>
            </div>
          </div>

          <div className="install-warning">
            <span className="install-warning__icon">⚠️</span>
            <p>
              <strong>Catatan:</strong> Perangkat mungkin menampilkan peringatan
              tentang "Sumber tidak dikenal". Ini normal karena update di luar Play Store.
            </p>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn--secondary" onClick={onClose}>
            Nanti Saja
          </button>
        </div>
      </div>
    </div>
  );
}

export const sideloadingStyles = `
.sideloading-inline {
  font-size: 0.85rem;
  color: #666;
}

.sideloading-inline summary {
  cursor: pointer;
  color: #007AFF;
  font-weight: 500;
}

.sideloading-inline__content {
  margin-top: 0.5rem;
  padding-left: 1rem;
}

.sideloading-inline__content ol {
  margin: 0.5rem 0;
  padding-left: 1.25rem;
}

.sideloading-inline__content li {
  margin: 0.25rem 0;
}

.sideloading-compact {
  background: none;
  border: none;
  color: #007AFF;
  cursor: pointer;
  font-size: 0.85rem;
  text-decoration: underline;
}

.sideloading-compact:hover {
  color: #0056CC;
}

.sideloading-helper {
  background: #F8F9FA;
  border-radius: 8px;
  padding: 1rem;
  margin: 1rem 0;
}

.sideloading-helper__toggle {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  text-align: left;
}

.sideloading-helper__icon {
  font-size: 1.25rem;
}

.sideloading-helper__title {
  flex: 1;
  font-weight: 600;
  color: #333;
}

.sideloading-helper__arrow {
  font-size: 0.75rem;
  color: #666;
}

.sideloading-helper__content {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid #E5E5EA;
}

.sideloading-section {
  margin-bottom: 1.25rem;
}

.sideloading-section:last-child {
  margin-bottom: 0;
}

.sideloading-section h4 {
  font-size: 0.9rem;
  margin: 0 0 0.5rem;
  color: #333;
}

.sideloading-section p {
  font-size: 0.85rem;
  color: #666;
  margin: 0.25rem 0;
  line-height: 1.5;
}

.sideloading-section--note {
  background: #E8F5E9;
  padding: 0.75rem;
  border-radius: 6px;
  margin-top: 1rem;
}

.sideloading-section--note h4 {
  color: #2E7D32;
}

.sideloading-steps {
  list-style: none;
  padding: 0;
  margin: 0;
}

.sideloading-steps li {
  margin-bottom: 1rem;
  padding-left: 1.5rem;
  position: relative;
}

.sideloading-steps li::before {
  content: counter(step);
  counter-increment: step;
  position: absolute;
  left: 0;
  top: 0;
}

.sideloading-steps {
  counter-reset: step;
}

.sideloading-steps h4 {
  display: inline;
}

.sideloading-steps p,
.sideloading-steps ul {
  font-size: 0.8rem;
  color: #666;
  margin: 0.25rem 0 0 0;
}

.sideloading-steps ul {
  list-style: disc;
  padding-left: 1.25rem;
  margin-top: 0.25rem;
}

.sideloading-steps li li {
  margin-bottom: 0.25rem;
}

.sideloading-helper__contact {
  width: 100%;
  padding: 0.5rem;
  background: #007AFF;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 500;
}

.sideloading-helper__contact:hover {
  background: #0056CC;
}

/* Modal Styles */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  padding: 1rem;
}

.modal-content {
  background: white;
  border-radius: 12px;
  max-width: 400px;
  width: 100%;
  max-height: 90vh;
  overflow-y: auto;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem;
  border-bottom: 1px solid #E5E5EA;
}

.modal-header h3 {
  margin: 0;
  font-size: 1rem;
}

.modal-close {
  background: none;
  border: none;
  font-size: 1.25rem;
  cursor: pointer;
  opacity: 0.5;
}

.modal-close:hover {
  opacity: 1;
}

.modal-body {
  padding: 1rem;
}

.modal-footer {
  padding: 1rem;
  border-top: 1px solid #E5E5EA;
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

.install-step {
  display: flex;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.install-step__number {
  width: 24px;
  height: 24px;
  background: #007AFF;
  color: white;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  font-weight: 600;
  flex-shrink: 0;
}

.install-step__content h4 {
  margin: 0 0 0.25rem;
  font-size: 0.9rem;
}

.install-step__content p {
  margin: 0;
  font-size: 0.8rem;
  color: #666;
}

.install-warning {
  background: #FFF3E0;
  padding: 0.75rem;
  border-radius: 6px;
  display: flex;
  gap: 0.5rem;
  margin-top: 1rem;
}

.install-warning__icon {
  font-size: 1rem;
}

.install-warning p {
  margin: 0;
  font-size: 0.8rem;
  color: #E65100;
}

.btn {
  padding: 0.5rem 1rem;
  border-radius: 6px;
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: all 0.2s;
}

.btn--primary {
  background: #007AFF;
  color: white;
}

.btn--secondary {
  background: #E5E5EA;
  color: #333;
}

.btn:hover:not(:disabled) {
  opacity: 0.9;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
`;




export default SideloadingHelper;
