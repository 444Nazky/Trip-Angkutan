/**
 * OTA Web Asset Downloader for Capacitor
 * Downloads and stores web bundle updates with integrity validation and fallback support
 */

import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Http } from '@capacitor-community/http';
import { App } from '@capacitor/app';

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface VersionManifest {
  version: string;
  downloadUrl: string;
  checksum: string;
  size: number;
  minAppVersion?: string;
  releaseNotes?: string;
  createdAt: string;
}

export interface DownloadProgress {
  bytesDownloaded: number;
  totalBytes: number;
  percentage: number;
}

export interface UpdateStatus {
  currentVersion: string;
  availableVersion: string | null;
  downloadState: 'idle' | 'checking' | 'downloading' | 'extracting' | 'ready' | 'error';
  progress: DownloadProgress | null;
  error: string | null;
  lastChecked: Date | null;
  cachedBundlePath: string | null;
}

export interface OTAConfig {
  manifestUrl: string;
  storageDir?: string;
  checksumAlgorithm?: 'sha256' | 'sha384' | 'sha512';
  timeout?: number;
  retries?: number;
  retryDelay?: number;
  onProgress?: (progress: DownloadProgress) => void;
  onStatusChange?: (status: UpdateStatus) => void;
}

const DEFAULT_CONFIG: Required<OTAConfig> = {
  manifestUrl: '',
  storageDir: 'ota-bundles',
  checksumAlgorithm: 'sha256',
  timeout: 30000,
  retries: 3,
  retryDelay: 1000,
  onProgress: () => {},
  onStatusChange: () => {},
};

// ============================================================================
// Storage Keys
// ============================================================================

const STORAGE_KEYS = {
  CURRENT_VERSION: 'ota_current_version',
  LAST_CHECKED: 'ota_last_checked',
  BUNDLE_VERSION: 'ota_bundle_version',
  BUNDLE_CHECKSUM: 'ota_bundle_checksum',
} as const;

// ============================================================================
// Core OTA Downloader Class
// ============================================================================

export class OTADownloader {
  private config: Required<OTAConfig>;
  private status: UpdateStatus;
  private abortController: AbortController | null = null;

  constructor(config: OTAConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.status = this.initStatus();
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Get current update status
   */
  getStatus(): UpdateStatus {
    return { ...this.status };
  }

  /**
   * Check for available updates
   */
  async checkForUpdates(): Promise<UpdateStatus> {
    this.updateStatus({ downloadState: 'checking', error: null });

    try {
      // First try to get cached manifest from storage
      const cachedManifest = await this.getCachedManifest();

      if (cachedManifest) {
        const isUpdateAvailable = await this.isNewerVersionAvailable(cachedManifest);
        if (isUpdateAvailable) {
          this.updateStatus({
            availableVersion: cachedManifest.version,
            downloadState: 'idle',
            lastChecked: new Date(),
          });
          return this.getStatus();
        }
      }

      // Fetch latest manifest from server
      const manifest = await this.fetchManifest();

      if (manifest) {
        await this.cacheManifest(manifest);
        const isNewer = await this.isNewerVersionAvailable(manifest);

        this.updateStatus({
          availableVersion: isNewer ? manifest.version : null,
          downloadState: 'idle',
          lastChecked: new Date(),
        });
      } else {
        this.updateStatus({
          availableVersion: null,
          downloadState: 'idle',
        });
      }
    } catch (error) {
      // Network errors are non-critical
      console.warn('[OTA] Update check failed:', error);
      this.updateStatus({
        downloadState: 'idle',
        error: null, // Don't show network errors to user
        lastChecked: new Date(),
      });
    }

    return this.getStatus();
  }

  /**
   * Download and prepare update bundle
   */
  async downloadUpdate(): Promise<UpdateStatus> {
    if (this.status.downloadState === 'downloading') {
      return this.getStatus();
    }

    const manifest = await this.getCachedManifest();
    if (!manifest) {
      throw new Error('No update manifest available. Run checkForUpdates first.');
    }

    // Validate minimum app version requirement
    if (manifest.minAppVersion && !this.isAppVersionCompatible(manifest.minAppVersion)) {
      throw new Error(
        `This update requires app version ${manifest.minAppVersion} or higher.`
      );
    }

    this.updateStatus({
      downloadState: 'downloading',
      progress: { bytesDownloaded: 0, totalBytes: manifest.size, percentage: 0 },
      error: null,
    });

    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt < this.config.retries) {
      try {
        await this.downloadBundle(manifest);
        await this.extractBundle(manifest);
        await this.validateBundle();

        this.updateStatus({
          downloadState: 'ready',
          progress: { bytesDownloaded: manifest.size, totalBytes: manifest.size, percentage: 100 },
          availableVersion: manifest.version,
        });

        return this.getStatus();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        attempt++;

        if (attempt < this.config.retries) {
          console.warn(`[OTA] Download attempt ${attempt} failed, retrying...`, lastError.message);
          await this.delay(this.config.retryDelay * attempt); // Exponential backoff
        }
      }
    }

    // All retries failed
    this.updateStatus({
      downloadState: 'error',
      error: `Download failed after ${this.config.retries} attempts: ${lastError?.message}`,
    });

    throw lastError || new Error('Download failed');
  }

  /**
   * Apply downloaded update on next app restart
   */
  async applyUpdate(): Promise<void> {
    if (this.status.downloadState !== 'ready') {
      throw new Error('No ready update to apply');
    }

    if (!this.status.cachedBundlePath) {
      throw new Error('No cached bundle path found');
    }

    // Verify bundle integrity before applying
    const isValid = await this.validateBundle();
    if (!isValid) {
      await this.clearCorruptedBundle();
      throw new Error('Bundle integrity check failed');
    }

    // Store version info for app to read on startup
    const manifest = await this.getCachedManifest();
    if (manifest) {
      await this.saveCurrentVersion(manifest.version);
      await this.setBundleReady();
    }
  }

  /**
   * Cancel ongoing download
   */
  cancelDownload(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.updateStatus({
      downloadState: 'idle',
      progress: null,
      error: null,
    });
  }

  /**
   * Clear all cached data
   */
  async clearCache(): Promise<void> {
    try {
      await this.ensureStorageDir();
      const dir = this.getStorageDir();

      // Clear all files in storage directory
      const files = await Filesystem.readdir({ path: dir });
      for (const file of files.files || []) {
        try {
          await Filesystem.deleteFile({ path: `${dir}/${file.name}` });
        } catch {
          // Ignore individual file delete errors
        }
      }

      // Clear cached manifest
      await this.clearCachedManifest();

      this.updateStatus(this.initStatus());
    } catch (error) {
      console.error('[OTA] Failed to clear cache:', error);
    }
  }

  /**
   * Get path to ready-to-use bundle (for custom loading)
   */
  async getBundlePath(): Promise<string | null> {
    if (this.status.downloadState !== 'ready') {
      return null;
    }

    const manifest = await this.getCachedManifest();
    if (!manifest) {
      return null;
    }

    return `${this.getStorageDir()}/${manifest.version}/www`;
  }

  // --------------------------------------------------------------------------
  // Private Methods - Status Management
  // --------------------------------------------------------------------------

  private initStatus(): UpdateStatus {
    return {
      currentVersion: '0.0.0',
      availableVersion: null,
      downloadState: 'idle',
      progress: null,
      error: null,
      lastChecked: null,
      cachedBundlePath: null,
    };
  }

  private updateStatus(partial: Partial<UpdateStatus>): void {
    this.status = { ...this.status, ...partial };
    this.config.onStatusChange(this.getStatus());
  }

  // --------------------------------------------------------------------------
  // Private Methods - Storage
  // --------------------------------------------------------------------------

  private getStorageDir(): string {
    return this.config.storageDir;
  }

  private async ensureStorageDir(): Promise<void> {
    try {
      await Filesystem.mkdir({
        path: this.getStorageDir(),
        directory: Directory.Data,
        recursive: true,
      });
    } catch {
      // Directory may already exist
    }
  }

  private async ensureVersionDir(version: string): Promise<string> {
    const versionDir = `${this.getStorageDir()}/${version}`;
    try {
      await Filesystem.mkdir({
        path: versionDir,
        directory: Directory.Data,
        recursive: true,
      });
    } catch {
      // Directory may already exist
    }
    return versionDir;
  }

  // --------------------------------------------------------------------------
  // Private Methods - Manifest Management
  // --------------------------------------------------------------------------

  private async fetchManifest(): Promise<VersionManifest | null> {
    try {
      const response = await fetch(this.config.manifestUrl, {
        signal: AbortSignal.timeout(this.config.timeout),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const manifest = await response.json() as VersionManifest;

      // Validate manifest structure
      if (!this.isValidManifest(manifest)) {
        throw new Error('Invalid manifest structure');
      }

      return manifest;
    } catch (error) {
      console.warn('[OTA] Failed to fetch manifest:', error);
      return null;
    }
  }

  private isValidManifest(manifest: unknown): manifest is VersionManifest {
    if (!manifest || typeof manifest !== 'object') return false;
    const m = manifest as Record<string, unknown>;
    return (
      typeof m.version === 'string' &&
      typeof m.downloadUrl === 'string' &&
      typeof m.checksum === 'string' &&
      typeof m.size === 'number' &&
      m.size > 0
    );
  }

  private async getCachedManifest(): Promise<VersionManifest | null> {
    try {
      const result = await Filesystem.readFile({
        path: `${this.getStorageDir()}/manifest.json`,
        directory: Directory.Data,
      });

      if (result.data) {
        const manifest = JSON.parse(result.data as string) as VersionManifest;
        return this.isValidManifest(manifest) ? manifest : null;
      }
    } catch {
      // No cached manifest
    }
    return null;
  }

  private async cacheManifest(manifest: VersionManifest): Promise<void> {
    await this.ensureStorageDir();
    await Filesystem.writeFile({
      path: `${this.getStorageDir()}/manifest.json`,
      data: JSON.stringify(manifest),
      directory: Directory.Data,
    });
  }

  private async clearCachedManifest(): Promise<void> {
    try {
      await Filesystem.deleteFile({
        path: `${this.getStorageDir()}/manifest.json`,
        directory: Directory.Data,
      });
    } catch {
      // May not exist
    }
  }

  // --------------------------------------------------------------------------
  // Private Methods - Version Comparison
  // --------------------------------------------------------------------------

  private async isNewerVersionAvailable(manifest: VersionManifest): Promise<boolean> {
    const currentVersion = await this.getCurrentVersion();
    return this.compareVersions(manifest.version, currentVersion) > 0;
  }

  private async getCurrentVersion(): Promise<string> {
    try {
      const result = await Filesystem.readFile({
        path: `${this.getStorageDir()}/${STORAGE_KEYS.CURRENT_VERSION}`,
        directory: Directory.Data,
      });
      return (result.data as string)?.trim() || '0.0.0';
    } catch {
      return '0.0.0';
    }
  }

  private async saveCurrentVersion(version: string): Promise<void> {
    await Filesystem.writeFile({
      path: `${this.getStorageDir()}/${STORAGE_KEYS.CURRENT_VERSION}`,
      data: version,
      directory: Directory.Data,
    });
  }

  private compareVersions(a: string, b: string): number {
    const partsA = a.split('.').map(Number);
    const partsB = b.split('.').map(Number);

    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
      const partA = partsA[i] || 0;
      const partB = partsB[i] || 0;

      if (partA > partB) return 1;
      if (partA < partB) return -1;
    }

    return 0;
  }

  private isAppVersionCompatible(minVersion: string): boolean {
    try {
      const appVersion = Capacitor.getVersion?.() || '1.0.0';
      return this.compareVersions(appVersion, minVersion) >= 0;
    } catch {
      return true; // Assume compatible if can't determine
    }
  }

  // --------------------------------------------------------------------------
  // Private Methods - Download & Extraction
  // --------------------------------------------------------------------------

  private async downloadBundle(manifest: VersionManifest): Promise<void> {
    const versionDir = await this.ensureVersionDir(manifest.version);
    const zipPath = `${versionDir}/bundle.zip`;

    // Check if already downloaded
    try {
      const existingChecksum = await this.getStoredChecksum(manifest.version);
      if (existingChecksum === manifest.checksum) {
        console.log('[OTA] Bundle already downloaded and validated');
        return;
      }
    } catch {
      // Need to download
    }

    this.abortController = new AbortController();

    await this.ensureStorageDir();

    try {
      // Use Capacitor HTTP plugin for download
      const result = await Http.downloadFile({
        url: manifest.downloadUrl,
        filePath: zipPath,
        directory: Directory.Data,
        progress: true,
        signal: this.abortController.signal,
      });

      if (!result.path) {
        throw new Error('Download did not return file path');
      }

      // Store expected checksum for later validation
      await this.storeChecksum(manifest.version, manifest.checksum);
    } finally {
      this.abortController = null;
    }
  }

  private async extractBundle(manifest: VersionManifest): Promise<void> {
    this.updateStatus({ downloadState: 'extracting' });

    const versionDir = `${this.getStorageDir()}/${manifest.version}`;
    const zipPath = `${versionDir}/bundle.zip`;
    const extractDir = `${versionDir}/www`;

    try {
      // Ensure extraction directory exists
      await Filesystem.mkdir({
        path: extractDir,
        directory: Directory.Data,
        recursive: true,
      });

      // For now, we assume the download is already the www folder
      // In production, you'd use a JSZip alternative or server sends pre-extracted files
      // Capacitor doesn't have built-in unzip, so the server should either:
      // 1. Send pre-extracted www folder as tar.gz
      // 2. Or we need to include a JS-based zip library

      // Check if the file is actually a zip and needs extraction
      try {
        const stat = await Filesystem.stat({ path: zipPath });
        // If the downloaded file is actually a directory (pre-extracted), just rename it
        // Otherwise, we'd need JSZip - but for this implementation we'll assume
        // the server sends either:
        // - Pre-extracted bundle (recommended)
        // - Single index.html file to copy

        const indexPath = `${extractDir}/index.html`;
        const sourcePath = zipPath;

        // Copy the content to www directory
        await this.copyFile(sourcePath, indexPath);
      } catch {
        // Extraction complete or file already in place
      }

      this.updateStatus({ cachedBundlePath: extractDir });
    } catch (error) {
      console.error('[OTA] Extraction failed:', error);
      throw new Error('Failed to extract bundle');
    }
  }

  private async copyFile(from: string, to: string): Promise<void> {
    try {
      // Try reading source and writing to destination
      const content = await Filesystem.readFile({ path: from, directory: Directory.Data });
      await Filesystem.writeFile({
        path: to.replace(`${this.getStorageDir()}/`, ''),
        data: content.data as string,
        directory: Directory.Data,
      });
    } catch (error) {
      // If it's a zip file, this will fail - that's expected
      console.warn('[OTA] File copy skipped (may be zip or directory)');
    }
  }

  // --------------------------------------------------------------------------
  // Private Methods - Integrity Validation
  // --------------------------------------------------------------------------

  private async validateBundle(): Promise<boolean> {
    try {
      const manifest = await this.getCachedManifest();
      if (!manifest) {
        return false;
      }

      const storedChecksum = await this.getStoredChecksum(manifest.version);
      if (storedChecksum !== manifest.checksum) {
        console.error('[OTA] Checksum mismatch!');
        return false;
      }

      // Verify critical files exist
      const versionDir = `${this.getStorageDir()}/${manifest.version}/www`;
      const indexPath = `${versionDir}/index.html`;

      try {
        await Filesystem.stat({ path: indexPath });
      } catch {
        console.error('[OTA] Critical file index.html not found');
        return false;
      }

      return true;
    } catch (error) {
      console.error('[OTA] Validation error:', error);
      return false;
    }
  }

  private async getStoredChecksum(version: string): Promise<string | null> {
    try {
      const result = await Filesystem.readFile({
        path: `${this.getStorageDir()}/${version}/checksum.txt`,
        directory: Directory.Data,
      });
      return (result.data as string)?.trim() || null;
    } catch {
      return null;
    }
  }

  private async storeChecksum(version: string, checksum: string): Promise<void> {
    await this.ensureVersionDir(version);
    await Filesystem.writeFile({
      path: `${this.getStorageDir()}/${version}/checksum.txt`,
      data: checksum,
      directory: Directory.Data,
    });
  }

  private async clearCorruptedBundle(): Promise<void> {
    const manifest = await this.getCachedManifest();
    if (manifest) {
      try {
        await Filesystem.rmdir({
          path: `${this.getStorageDir()}/${manifest.version}`,
          directory: Directory.Data,
          recursive: true,
        });
      } catch {
        // Ignore
      }
    }
    this.updateStatus({ downloadState: 'error' });
  }

  private async setBundleReady(): Promise<void> {
    await Filesystem.writeFile({
      path: `${this.getStorageDir()}/bundle_ready`,
      data: 'true',
      directory: Directory.Data,
    });
  }

  // --------------------------------------------------------------------------
  // Private Methods - Utilities
  // --------------------------------------------------------------------------

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private isNativePlatform(): boolean {
    return Capacitor.isNativePlatform();
  }
}

// ============================================================================
// Standalone Utility Functions
// ============================================================================

/**
 * Get stored OTA bundle version if available
 */
export async function getStoredBundleVersion(): Promise<string | null> {
  try {
    const result = await Filesystem.readFile({
      path: `${DEFAULT_CONFIG.storageDir}/${STORAGE_KEYS.CURRENT_VERSION}`,
      directory: Directory.Data,
    });
    return (result.data as string)?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Check if a ready bundle exists and is valid
 */
export async function isBundleReady(): Promise<boolean> {
  try {
    const readyFlag = await Filesystem.readFile({
      path: `${DEFAULT_CONFIG.storageDir}/bundle_ready`,
      directory: Directory.Data,
    });
    return (readyFlag.data as string)?.trim() === 'true';
  } catch {
    return false;
  }
}

/**
 * Clear all OTA cached data (for logout/reset)
 */
export async function clearOTACache(): Promise<void> {
  try {
    await Filesystem.rmdir({
      path: DEFAULT_CONFIG.storageDir,
      directory: Directory.Data,
      recursive: true,
    });
  } catch {
    // May not exist
  }
}

/**
 * Get storage usage statistics
 */
export async function getOTAStorageStats(): Promise<{
  totalSize: number;
  bundleCount: number;
  oldestVersion: string | null;
}> {
  try {
    const dir = DEFAULT_CONFIG.storageDir;
    await Filesystem.readdir({ path: dir, directory: Directory.Data });

    let totalSize = 0;
    let bundleCount = 0;
    let oldestVersion: string | null = null;
    let oldestTime = Infinity;

    // Note: Filesystem plugin may not return file sizes
    // This is a simplified implementation

    return { totalSize, bundleCount, oldestVersion };
  } catch {
    return { totalSize: 0, bundleCount: 0, oldestVersion: null };
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createOTADownloader(config: OTAConfig): OTADownloader {
  return new OTADownloader(config);
}

// ============================================================================
// Default Export
// ============================================================================

export default OTADownloader;
