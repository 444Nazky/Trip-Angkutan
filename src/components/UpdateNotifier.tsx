// ─── Update Notifier Component ───────────────────────────────────────────────
// Custom Self-Hosted API Update System UI

import { useState, useEffect, useCallback } from 'react';
import { updateService, type UpdateState, type UpdateInfo, type UpdateError } from '../services/updateService';

interface UpdateNotifierProps {
  /** Callback when update is ready to install */
  onUpdateReady?: (version: string) => void;
  /** Callback when update is applied (app will restart) */
  onUpdateApplied?: () => void;
  /** Callback when error occurs */
  onError?: (error: UpdateError) => void;
  /** Auto-check on mount (default: true) */
  autoCheck?: boolean;
  /** Show force update banner (default: true) */
  showForceUpdate?: boolean;
}

interface UpdateNotifierUI {
  state: UpdateState;
  info: UpdateInfo | null;
  error: UpdateError | null;
  pendingVersion: string | null;
  currentVersion: string;
}

export function useUpdateNotifier(): UpdateNotifierUI {
  const [state, setState] = useState<UpdateState>('idle');
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [error, setError] = useState<UpdateError | null>(null);

  useEffect(() => {
    // Subscribe to update service state changes
    const unsubscribe = updateService.subscribe((newState, newInfo, newError) => {
      setState(newState);
      setInfo(newInfo || null);
      setError(newError || null);
    });

    return unsubscribe;
  }, []);

  return {
    state,
    info,
    error,
    pendingVersion: updateService.pendingVersion,
    currentVersion: updateService.currentVersion,
  };
}

export function UpdateNotifier({
  onUpdateReady,
  onUpdateApplied,
  onError,
  autoCheck = true,
  showForceUpdate = true,
}: UpdateNotifierProps) {
  const { state, info, error, pendingVersion, currentVersion } = useUpdateNotifier();

  // Auto-check for updates on mount
  useEffect(() => {
    if (autoCheck && (state === 'idle' || state === 'up-to-date')) {
      checkForUpdates();
    }
  }, [autoCheck]);

  // Notify parent of state changes
  useEffect(() => {
    if (state === 'ready' && pendingVersion) {
      onUpdateReady?.(pendingVersion);
    }
    if (state === 'installing') {
      onUpdateApplied?.();
    }
    if (state === 'error' && error) {
      onError?.(error);
    }
  }, [state, pendingVersion, error, onUpdateReady, onUpdateApplied, onError]);

  const checkForUpdates = useCallback(async () => {
    await updateService.checkForUpdate();
  }, []);

  const installUpdate = useCallback(async () => {
    await updateService.installUpdate();
  }, []);

  const retryUpdate = useCallback(async () => {
    if (info?.downloadUrl) {
      await updateService.downloadUpdate(info.latestVersion, info.downloadUrl, info.apkHash);
    }
  }, [info]);

  const resetUpdate = useCallback(async () => {
    await updateService.reset();
  }, []);

  // Don't show anything if up-to-date or idle
  if (state === 'up-to-date' || state === 'idle') {
    return null;
  }

  // Force update banner (can't be dismissed)
  if (showForceUpdate && info?.isForceUpdate && state !== 'installing') {
    return (
      <div className="update-notifier update-notifier--force">
        <div className="update-notifier__icon">🔒</div>
        <div className="update-notifier__content">
          <h4>Update Wajib</h4>
          <p>
            Aplikasi harus diperbarui ke versi <strong>{info?.latestVersion}</strong> untuk melanjutkan.
          </p>
          {info?.releaseNotes && (
            <p className="update-notifier__notes">{info.releaseNotes}</p>
          )}
        </div>
        <div className="update-notifier__actions">
          {state === 'downloading' ? (
            <button className="btn btn--loading" disabled>
              <span className="spinner"></span>
              Mengunduh...
            </button>
          ) : state === 'ready' ? (
            <button className="btn btn--primary" onClick={installUpdate}>
              Pasang Update
            </button>
          ) : state === 'error' ? (
            <button className="btn btn--primary" onClick={retryUpdate}>
              Coba Lagi
            </button>
          ) : (
            <button className="btn btn--primary" onClick={checkForUpdates} disabled={state === 'checking'}>
              {state === 'checking' ? 'Mengecek...' : 'Update Sekarang'}
            </button>
          )}
        </div>
      </div>
    );
  }

  // Normal update notification
  return (
    <div className={`update-notifier update-notifier--${state}`}>
      {/* Header */}
      <div className="update-notifier__header">
        <span className="update-notifier__icon">
          {state === 'checking' && '🔄'}
          {state === 'downloading' && '⬇️'}
          {state === 'ready' && '✅'}
          {state === 'installing' && '🔄'}
          {state === 'error' && '❌'}
        </span>
        <div className="update-notifier__title">
          {state === 'checking' && 'Mengecek Pembaruan...'}
          {state === 'downloading' && `Mengunduh Update ${pendingVersion || ''}`}
          {state === 'ready' && 'Update Siap Diinstal'}
          {state === 'installing' && 'Memasang Update...'}
          {state === 'error' && 'Update Gagal'}
        </div>
        {!info?.isForceUpdate && state !== 'installing' && (
          <button
            className="update-notifier__close"
            onClick={resetUpdate}
            aria-label="Tutup"
          >
            ✕
          </button>
        )}
      </div>

      {/* Content */}
      <div className="update-notifier__content">
        {/* Progress for downloading */}
        {state === 'downloading' && (
          <div className="update-notifier__progress">
            <div className="progress-bar">
              <div className="progress-bar__fill progress-bar__fill--animated"></div>
            </div>
            <span className="progress-text">Mengunduh file...</span>
          </div>
        )}

        {/* Version info */}
        {(state === 'downloading' || state === 'ready' || state === 'error') && (
          <p className="update-notifier__version">
            {currentVersion} → <strong>{info?.latestVersion || pendingVersion}</strong>
          </p>
        )}

        {/* Release notes */}
        {info?.releaseNotes && (state === 'ready' || state === 'downloading') && (
          <details className="update-notifier__details">
            <summary>Catatan Rilis</summary>
            <p>{info.releaseNotes}</p>
          </details>
        )}

        {/* Error message */}
        {state === 'error' && error && (
          <p className="update-notifier__error">{error.message}</p>
        )}
      </div>

      {/* Actions */}
      <div className="update-notifier__actions">
        {state === 'checking' && (
          <button className="btn btn--secondary" disabled>
            <span className="spinner spinner--small"></span>
            Mengecek...
          </button>
        )}

        {state === 'downloading' && (
          <button className="btn btn--secondary" disabled>
            <span className="spinner spinner--small"></span>
            Mengunduh...
          </button>
        )}

        {state === 'ready' && (
          <button className="btn btn--primary" onClick={installUpdate}>
            Pasang Update
          </button>
        )}

        {state === 'installing' && (
          <button className="btn btn--primary" disabled>
            <span className="spinner spinner--small"></span>
            Memasang...
          </button>
        )}

        {state === 'error' && (
          <>
            <button className="btn btn--primary" onClick={retryUpdate}>
              Coba Lagi
            </button>
            <button className="btn btn--ghost" onClick={resetUpdate}>
              Tutup
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Update Status Badge ─────────────────────────────────────────────────────

interface UpdateStatusBadgeProps {
  className?: string;
}

export function UpdateStatusBadge({ className = '' }: UpdateStatusBadgeProps) {
  const { state, info, currentVersion } = useUpdateNotifier();

  if (state === 'up-to-date' || state === 'idle') {
    return (
      <span className={`update-badge update-badge--current ${className}`}>
        ✅ v{currentVersion}
      </span>
    );
  }

  if (state === 'checking' || state === 'downloading' || state === 'ready') {
    return (
      <span className={`update-badge update-badge--available ${className}`}>
        🔄 v{info?.latestVersion || '?'}
      </span>
    );
  }

  if (state === 'error') {
    return (
      <span className={`update-badge update-badge--error ${className}`}>
        ❌ Update Gagal
      </span>
    );
  }

  return null;
}

// ─── Styles ─────────────────────────────────────────────────────────────────

// These styles can be added to your global CSS or Tailwind config
export const updateStyles = `
.update-notifier {
  position: fixed;
  bottom: 1rem;
  left: 1rem;
  right: 1rem;
  max-width: 400px;
  margin: 0 auto;
  background: white;
  border-radius: 12px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  padding: 1rem;
  z-index: 1000;
  font-family: system-ui, -apple-system, sans-serif;
}

.update-notifier--force {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  max-width: none;
  border-radius: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

.update-notifier--force .update-notifier__icon {
  font-size: 4rem;
  margin-bottom: 1rem;
}

.update-notifier--force h4 {
  font-size: 1.5rem;
  margin: 0 0 0.5rem;
}

.update-notifier--force p {
  opacity: 0.9;
  max-width: 300px;
}

.update-notifier__header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.update-notifier__icon {
  font-size: 1.5rem;
}

.update-notifier__title {
  flex: 1;
  font-weight: 600;
  font-size: 0.9rem;
}

.update-notifier__close {
  background: none;
  border: none;
  padding: 0.25rem;
  cursor: pointer;
  opacity: 0.5;
  font-size: 1rem;
}

.update-notifier__close:hover {
  opacity: 1;
}

.update-notifier__content {
  margin: 0.5rem 0;
}

.update-notifier__version {
  font-size: 0.85rem;
  color: #666;
  margin: 0.25rem 0;
}

.update-notifier__notes {
  font-size: 0.8rem;
  color: #888;
  margin: 0.5rem 0 0;
}

.update-notifier__details {
  margin-top: 0.5rem;
  font-size: 0.8rem;
}

.update-notifier__details summary {
  cursor: pointer;
  color: #007AFF;
  font-weight: 500;
}

.update-notifier__details p {
  margin: 0.5rem 0 0;
  color: #666;
  padding-left: 1rem;
}

.update-notifier__error {
  color: #FF3B30;
  font-size: 0.85rem;
  margin: 0.25rem 0;
}

.update-notifier__progress {
  margin: 0.5rem 0;
}

.progress-bar {
  height: 4px;
  background: #E5E5EA;
  border-radius: 2px;
  overflow: hidden;
}

.progress-bar__fill {
  height: 100%;
  background: #007AFF;
  transition: width 0.3s ease;
}

.progress-bar__fill--animated {
  width: 100%;
  animation: progress-indeterminate 1.5s infinite linear;
  background: linear-gradient(90deg, #007AFF 0%, #5AC8FA 50%, #007AFF 100%);
  background-size: 200% 100%;
}

@keyframes progress-indeterminate {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.progress-text {
  font-size: 0.75rem;
  color: #888;
  display: block;
  margin-top: 0.25rem;
}

.update-notifier__actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.75rem;
}

/* Buttons */
.btn {
  padding: 0.5rem 1rem;
  border-radius: 8px;
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

.btn--primary:hover:not(:disabled) {
  background: #0056CC;
}

.btn--secondary {
  background: #E5E5EA;
  color: #333;
}

.btn--ghost {
  background: transparent;
  color: #666;
}

.btn--ghost:hover {
  background: #F0F0F0;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn--loading {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

/* Spinner */
.spinner {
  width: 16px;
  height: 16px;
  border: 2px solid transparent;
  border-top-color: currentColor;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.spinner--small {
  width: 12px;
  height: 12px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Update Badge */
.update-badge {
  display: inline-flex;
  align-items: center;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 500;
}

.update-badge--current {
  background: #E8F5E9;
  color: #2E7D32;
}

.update-badge--available {
  background: #E3F2FD;
  color: #1565C0;
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}

.update-badge--error {
  background: #FFEBEE;
  color: #C62828;
}

/* Force Update Override Button Styles */
.update-notifier--force .btn--primary {
  background: white;
  color: #667eea;
  font-size: 1rem;
  padding: 0.75rem 2rem;
  margin-top: 1rem;
}

.update-notifier--force .btn--loading {
  background: rgba(255, 255, 255, 0.3);
}
`;

export default UpdateNotifier;
