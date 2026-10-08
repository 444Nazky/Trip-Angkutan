/**
 * Version Checker Module
 * Automatic version comparison between local app and GitHub remote
 *
 * Fetches version metadata from GitHub repository (mobile branch)
 * and compares with local application version.
 */

import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

// ============================================================
// Types & Interfaces
// ============================================================

export interface RemoteVersion {
  version: string;
  buildNumber?: string;
  commitHash?: string;
  releaseDate?: string;
  releaseNotes?: string;
  downloadUrl?: string;
}

export interface LocalVersion {
  version: string;
  buildNumber?: string;
  commitHash?: string;
}

export interface VersionCheckResult {
  updateAvailable: boolean;
  remoteVersion: RemoteVersion | null;
  localVersion: LocalVersion | null;
  comparison: VersionComparison;
  error: string | null;
}

export interface VersionComparison {
  isNewer: boolean;
  isSame: boolean;
  needsUpdate: boolean;
  majorDiff: boolean;
  minorDiff: boolean;
  patchDiff: boolean;
}

export enum UpdatePriority {
  CRITICAL = 'critical',   // Major version difference
  HIGH = 'high',           // Minor version difference
  NORMAL = 'normal',       // Patch version difference
  LOW = 'low',             // Same version
  UNKNOWN = 'unknown',
}

export interface UpdateCheckOptions {
  /** GitHub repository in format "owner/repo" */
  repo?: string;
  /** Branch name to check */
  branch?: string;
  /** Path to version file in repository */
  versionFilePath?: string;
  /** Custom GitHub token for private repos or higher rate limits */
  githubToken?: string;
  /** Whether to include pre-release versions */
  includePrerelease?: boolean;
  /** URL to remote manifest/endpoint */
  manifestUrl?: string;
}

// ============================================================
// Constants
// ============================================================

const DEFAULT_REPO = '444Nazky/Aplikasi-Trip-Ionic';
const DEFAULT_BRANCH = 'mobile';
const DEFAULT_VERSION_FILE = 'version.json';
const GITHUB_API_BASE = 'https://api.github.com';
const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com';

const DEFAULT_OPTIONS: UpdateCheckOptions = {
  repo: DEFAULT_REPO,
  branch: DEFAULT_BRANCH,
  versionFilePath: DEFAULT_VERSION_FILE,
  includePrerelease: false,
  manifestUrl: `${window.location.origin}/api/version`,
};

// ============================================================
// Version Parsing Utilities
// ============================================================

/**
 * Parse semantic version string into components
 */
export function parseVersion(version: string): { major: number; minor: number; patch: number; prerelease: string | null } {
  // Clean version string
  const cleaned = version.replace(/^v/, '').trim();

  // Match semantic versioning pattern: major.minor.patch[-prerelease]
  const match = cleaned.match(/^(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z0-9.-]+))?$/);

  if (!match) {
    // Fallback for non-semver formats (e.g., commit hashes, date-based versions)
    return {
      major: 0,
      minor: 0,
      patch: 0,
      prerelease: cleaned,
    };
  }

  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4] || null,
  };
}

/**
 * Compare two version strings
 */
export function compareVersions(local: string, remote: string): VersionComparison {
  const localParsed = parseVersion(local);
  const remoteParsed = parseVersion(remote);

  let majorDiff = false;
  let minorDiff = false;
  let patchDiff = false;
  let isNewer = false;
  let isSame = true;
  let needsUpdate = false;

  if (remoteParsed.major !== localParsed.major) {
    majorDiff = remoteParsed.major > localParsed.major;
    isSame = false;
    needsUpdate = majorDiff;
    isNewer = majorDiff;
  } else if (remoteParsed.minor !== localParsed.minor) {
    minorDiff = remoteParsed.minor > localParsed.minor;
    isSame = false;
    needsUpdate = minorDiff;
    isNewer = minorDiff;
  } else if (remoteParsed.patch !== localParsed.patch) {
    patchDiff = remoteParsed.patch > localParsed.patch;
    isSame = false;
    needsUpdate = patchDiff;
    isNewer = patchDiff;
  } else if (localParsed.prerelease !== remoteParsed.prerelease) {
    // Different prerelease status
    isSame = false;
    needsUpdate = remoteParsed.prerelease !== null && localParsed.prerelease === null;
    isNewer = needsUpdate;
  }

  return {
    isNewer,
    isSame,
    needsUpdate,
    majorDiff,
    minorDiff,
    patchDiff,
  };
}

/**
 * Get update priority based on version difference
 */
export function getUpdatePriority(comparison: VersionComparison): UpdatePriority {
  if (comparison.majorDiff) return UpdatePriority.CRITICAL;
  if (comparison.minorDiff) return UpdatePriority.HIGH;
  if (comparison.patchDiff) return UpdatePriority.NORMAL;
  return UpdatePriority.LOW;
}

// ============================================================
// Local Version Retrieval
// ============================================================

/**
 * Get local application version from Capacitor/App configuration
 */
export async function getLocalVersion(): Promise<LocalVersion> {
  try {
    // Check if running in Capacitor environment
    if (Capacitor.isNativePlatform()) {
      const appInfo = await App.getInfo();
      return {
        version: appInfo.version || '0.0.0',
        buildNumber: appInfo.build || undefined,
        commitHash: undefined, // Not available from App plugin
      };
    }

    // Fallback for web/development environment
    // Read from package.json or app config
    const appVersion = import.meta.env?.VITE_APP_VERSION ||
                       (window as any).__APP_VERSION__ ||
                       '1.0.0';
    const buildNumber = import.meta.env?.VITE_APP_BUILD ||
                        (window as any).__APP_BUILD__ ||
                        undefined;

    return {
      version: appVersion,
      buildNumber: buildNumber,
      commitHash: undefined,
    };
  } catch (error) {
    console.warn('[VersionChecker] Failed to get local version:', error);
    return {
      version: '0.0.0',
      buildNumber: undefined,
      commitHash: undefined,
    };
  }
}

// ============================================================
// Remote Version Fetching
// ============================================================

/**
 * Build GitHub API URL for repository contents
 */
function buildGitHubApiUrl(
  owner: string,
  repo: string,
  branch: string,
  path: string
): string {
  return `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
}

/**
 * Build raw file URL for direct content access
 */
function buildRawFileUrl(
  owner: string,
  repo: string,
  branch: string,
  path: string
): string {
  return `${GITHUB_RAW_BASE}/${owner}/${repo}/${branch}/${path}`;
}

/**
 * Fetch version from custom manifest URL (backend API)
 * This is checked FIRST before GitHub as it's more reliable for internal deployments
 */
async function fetchFromManifestUrl(manifestUrl: string): Promise<RemoteVersion | null> {
  if (!manifestUrl) return null;

  try {
    const response = await fetch(manifestUrl, {
      headers: {
        'Accept': 'application/json',
        'Cache-Control': 'no-cache',
      },
    });

    if (response.ok) {
      const data = await response.json();
      return {
        version: data.version || '0.0.0',
        buildNumber: data.buildNumber || data.buildId || undefined,
        commitHash: data.commitHash || undefined,
        releaseDate: data.releaseDate || undefined,
        releaseNotes: data.releaseNotes || undefined,
        downloadUrl: data.downloadUrl || undefined,
      };
    }
  } catch (error) {
    console.warn('[VersionChecker] Manifest URL fetch failed:', error);
  }
  return null;
}

/**
 * Fetch version from GitHub repository
 * Tries multiple strategies in order of preference
 */
async function fetchRemoteVersion(options: Required<UpdateCheckOptions>): Promise<RemoteVersion | null> {
  const { repo, branch, versionFilePath, githubToken, manifestUrl } = options;

  // Strategy 0: Try custom manifest URL first (backend API)
  if (manifestUrl) {
    const manifestVersion = await fetchFromManifestUrl(manifestUrl);
    if (manifestVersion) return manifestVersion;
  }

  const [owner, repoName] = repo.split('/');

  if (!owner || !repoName) {
    throw new Error(`Invalid repository format: ${repo}. Expected "owner/repo"`);
  }

  const headers: HeadersInit = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'VersionChecker-Capacitor',
  };

  if (githubToken) {
    headers['Authorization'] = `Bearer ${githubToken}`;
  }

  // Strategy 1: Try GitHub API (for private repos or JSON files with metadata)
  try {
    const apiUrl = buildGitHubApiUrl(owner, repoName, branch, versionFilePath);
    const apiResponse = await fetch(apiUrl, { headers });

    if (apiResponse.ok) {
      const fileData = await apiResponse.json();

      // GitHub API returns base64 encoded content
      if (fileData.content) {
        const decodedContent = atob(fileData.content.replace(/\n/g, ''));

        try {
          const versionData = JSON.parse(decodedContent);
          return {
            version: versionData.version || versionData.tag_name?.replace(/^v/, '') || '0.0.0',
            buildNumber: versionData.buildNumber || versionData.build || undefined,
            commitHash: versionData.commitHash || versionData.sha || fileData.sha,
            releaseDate: versionData.releaseDate || versionData.published_at || undefined,
            releaseNotes: versionData.releaseNotes || versionData.body || undefined,
            downloadUrl: versionData.downloadUrl || versionData.html_url || undefined,
          };
        } catch {
          // Content is not JSON, try as plain text version
          return {
            version: decodedContent.trim(),
            commitHash: fileData.sha,
          };
        }
      }
    }
  } catch (apiError) {
    console.warn('[VersionChecker] GitHub API fetch failed:', apiError);
  }

  // Strategy 2: Try raw file URL (for public repos)
  try {
    const rawUrl = buildRawFileUrl(owner, repoName, branch, versionFilePath);
    const rawResponse = await fetch(rawUrl);

    if (rawResponse.ok) {
      const content = await rawResponse.text();

      // Try parsing as JSON
      try {
        const versionData = JSON.parse(content);
        return {
          version: versionData.version || '0.0.0',
          buildNumber: versionData.buildNumber || versionData.build || undefined,
          commitHash: versionData.commitHash || undefined,
          releaseDate: versionData.releaseDate || undefined,
          releaseNotes: versionData.releaseNotes || undefined,
          downloadUrl: versionData.downloadUrl || undefined,
        };
      } catch {
        // Plain text version
        return {
          version: content.trim(),
        };
      }
    }
  } catch (rawError) {
    console.warn('[VersionChecker] Raw file fetch failed:', rawError);
  }

  // Strategy 3: Try GitHub Releases API
  try {
    const releasesUrl = `${GITHUB_API_BASE}/repos/${owner}/${repoName}/releases/latest`;
    const releasesResponse = await fetch(releasesUrl, { headers });

    if (releasesResponse.ok) {
      const release = await releasesResponse.json();
      return {
        version: release.tag_name?.replace(/^v/, '') || '0.0.0',
        buildNumber: undefined,
        commitHash: release.target_commitish || undefined,
        releaseDate: release.published_at || undefined,
        releaseNotes: release.body || undefined,
        downloadUrl: release.html_url || undefined,
      };
    }
  } catch (releasesError) {
    console.warn('[VersionChecker] Releases API fetch failed:', releasesError);
  }

  // Strategy 4: Try GitHub Tags API
  try {
    const tagsUrl = `${GITHUB_API_BASE}/repos/${owner}/${repoName}/tags`;
    const tagsResponse = await fetch(tagsUrl, { headers });

    if (tagsResponse.ok) {
      const tags: Array<{ name: string; commit: { sha: string } }> = await tagsResponse.json();

      if (tags.length > 0) {
        // Sort tags to get latest (assuming semantic versioning sorted correctly)
        const latestTag = tags[0];
        return {
          version: latestTag.name.replace(/^v/, ''),
          commitHash: latestTag.commit.sha,
        };
      }
    }
  } catch (tagsError) {
    console.warn('[VersionChecker] Tags API fetch failed:', tagsError);
  }

  return null;
}

// ============================================================
// Main Version Check Function
// ============================================================

/**
 * Check if application update is available
 *
 * @param options - Configuration options for version check
 * @returns Promise resolving to version check result
 *
 * @example
 * ```typescript
 * const result = await checkForUpdate({
 *   repo: '444Nazky/Aplikasi-Trip-Ionic',
 *   branch: 'mobile',
 *   versionFilePath: 'version.json',
 * });
 *
 * if (result.updateAvailable) {
 *   console.log(`Update available: ${result.remoteVersion?.version}`);
 * }
 * ```
 */
export async function checkForUpdate(options: UpdateCheckOptions = {}): Promise<VersionCheckResult> {
  const mergedOptions: Required<UpdateCheckOptions> = {
    ...DEFAULT_OPTIONS,
    ...options,
  };

  try {
    // Fetch both local and remote versions in parallel
    const [localVersion, remoteVersion] = await Promise.all([
      getLocalVersion(),
      fetchRemoteVersion(mergedOptions),
    ]);

    // If remote version fetch failed
    if (!remoteVersion) {
      return {
        updateAvailable: false,
        remoteVersion: null,
        localVersion,
        comparison: {
          isNewer: false,
          isSame: true,
          needsUpdate: false,
          majorDiff: false,
          minorDiff: false,
          patchDiff: false,
        },
        error: 'Could not fetch remote version from GitHub',
      };
    }

    // Compare versions
    const comparison = compareVersions(localVersion.version, remoteVersion.version);

    // Determine if update is available
    const updateAvailable = comparison.needsUpdate &&
                          (mergedOptions.includePrerelease || !isPrerelease(remoteVersion.version));

    return {
      updateAvailable,
      remoteVersion,
      localVersion,
      comparison,
      error: null,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    console.error('[VersionChecker] Version check failed:', errorMessage);

    return {
      updateAvailable: false,
      remoteVersion: null,
      localVersion: await getLocalVersion(),
      comparison: {
        isNewer: false,
        isSame: true,
        needsUpdate: false,
        majorDiff: false,
        minorDiff: false,
        patchDiff: false,
      },
      error: errorMessage,
    };
  }
}

/**
 * Check if version string is a prerelease
 */
function isPrerelease(version: string): boolean {
  const parsed = parseVersion(version);
  return parsed.prerelease !== null;
}

// ============================================================
// Utility Functions
// ============================================================

/**
 * Check if update is critical (major version difference)
 */
export function isCriticalUpdate(result: VersionCheckResult): boolean {
  return result.updateAvailable && result.comparison.majorDiff;
}

/**
 * Get human-readable version difference description
 */
export function getVersionDiffDescription(result: VersionCheckResult): string {
  if (result.error) {
    return `Error: ${result.error}`;
  }

  if (!result.updateAvailable) {
    return 'Application is up to date';
  }

  const { localVersion, remoteVersion, comparison } = result;

  if (!remoteVersion) {
    return 'Update status unknown';
  }

  if (comparison.majorDiff) {
    return `New major version available: ${localVersion.version} → ${remoteVersion.version}`;
  }

  if (comparison.minorDiff) {
    return `New minor version available: ${localVersion.version} → ${remoteVersion.version}`;
  }

  if (comparison.patchDiff) {
    return `New patch available: ${localVersion.version} → ${remoteVersion.version}`;
  }

  return `Update available: ${localVersion.version} → ${remoteVersion.version}`;
}

/**
 * Format release notes for display
 */
export function formatReleaseNotes(notes: string | undefined): string {
  if (!notes) return '';

  // Simple markdown-like formatting
  return notes
    .replace(/^#+\s*/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .trim();
}

// ============================================================
// React Hook (for React-based applications)
// ============================================================

/**
 * Hook for reactive version checking in React components
 *
 * @example
 * ```tsx
 * import { useVersionCheck } from './version-checker';
 *
 * function UpdateBanner() {
 *   const { result, isLoading, refresh } = useVersionCheck();
 *
 *   if (isLoading) return <Skeleton />;
 *   if (!result?.updateAvailable) return null;
 *
 *   return (
 *     <Alert>
 *       <Alert.Title>Update Available!</Alert.Title>
 *       <Alert.Description>
 *         Version {result.remoteVersion?.version} is now available.
 *       </Alert.Description>
 *       <Alert.Action onClick={refresh}>Update Now</Alert.Action>
 *     </Alert>
 *   );
 * }
 * ```
 */
// Note: This is a basic hook implementation
// For production use, consider integrating with your state management solution

export interface UseVersionCheckOptions extends UpdateCheckOptions {
  /** Enable automatic checking on app foreground */
  checkOnForeground?: boolean;
  /** Interval for periodic checks (in milliseconds) */
  checkInterval?: number;
  /** Whether to start checking immediately on mount */
  immediate?: boolean;
}

export interface UseVersionCheckResult {
  result: VersionCheckResult | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  lastChecked: Date | null;
}

/**
 * React hook for version checking (requires React)
 * This is a template - implement based on your React setup
 */
export function createVersionCheckHook(
  _options: UseVersionCheckOptions = {}
): () => UseVersionCheckResult {
  // This is a placeholder for React integration
  // In a real implementation, you would use useState, useEffect, etc.

  return function useVersionCheck(): UseVersionCheckResult {
    // Placeholder return
    // Implement actual hook using useState/useEffect in your React app
    return {
      result: null,
      isLoading: false,
      error: null,
      refresh: async () => {},
      lastChecked: null,
    };
  };
}

// ============================================================
// Capacitor Plugin Integration
// ============================================================

/**
 * Initialize version checking with Capacitor App plugin listeners
 * Call this in your app initialization
 *
 * @param callback - Function to call when update is detected
 * @param options - Version check options
 */
export async function initializeVersionChecker(
  callback: (result: VersionCheckResult) => void,
  options: UpdateCheckOptions = {}
): Promise<{ check: () => Promise<void>; cleanup: () => void }> {
  // Check for updates immediately
  const check = async () => {
    const result = await checkForUpdate(options);
    callback(result);
  };

  // Set up Capacitor App state listener for foreground checks
  let cleanupFn: (() => void) | undefined;

  if (Capacitor.isNativePlatform()) {
    try {
      // Listen for app state changes (foreground)
      App.addListener('appStateChange', async ({ isActive }) => {
        if (isActive) {
          await check();
        }
      });

      cleanupFn = () => {
        // Cleanup listener if needed
      };
    } catch (error) {
      console.warn('[VersionChecker] Failed to set up App listener:', error);
    }
  }

  return {
    check,
    cleanup: cleanupFn || (() => {}),
  };
}

// ============================================================
// Default Export
// ============================================================

export default {
  checkForUpdate,
  getLocalVersion,
  compareVersions,
  parseVersion,
  getUpdatePriority,
  getVersionDiffDescription,
  isCriticalUpdate,
  formatReleaseNotes,
  initializeVersionChecker,
  // Types
  RemoteVersion,
  LocalVersion,
  VersionCheckResult,
  VersionComparison,
  UpdatePriority,
  UpdateCheckOptions,
};
