/**
 * Background Service Worker - Book More Extension
 * Handles periodic sync with Cloudflare Worker for dynamic URL updates
 */

const WORKER_URL = 'https://tiny-leaf-4d57.cccccccccccc.workers.dev/';
const SYNC_ALARM_NAME = 'sync-config';

const STORAGE_KEYS = {
  REMOTE_URLS: 'remoteUrls',      // Array of mirrors from worker
  ACTIVE_URL: 'activeUrl',        // Last working mirror
  CUSTOM_URL: 'customUrl',        // User override
  LAST_SYNC: 'lastSync',
  LAST_HEALTH_CHECK: 'lastHealthCheck'
};

const HEALTH_CHECK_TIMEOUT = 3000; // 3 seconds
const SYNC_INTERVAL_MINUTES = 60*24*3; // 3 days (mirrors can get blocked)

/**
 * Fetch URLs from Cloudflare Worker and update storage
 */
async function syncUrlsFromWorker() {
  console.log('[Background] Syncing URLs from Worker...');

  try {
    const response = await fetch(WORKER_URL, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) {
      throw new Error(`Worker returned ${response.status}`);
    }

    const data = await response.json();

    // Support both old format {url: string} and new format {urls: string[]}
    let urls = data.urls;
    if (!urls && data.url) {
      urls = [data.url];
    }
    
    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      throw new Error('No URLs in worker response');
    }

    await chrome.storage.local.set({
      [STORAGE_KEYS.REMOTE_URLS]: urls,
      [STORAGE_KEYS.LAST_SYNC]: new Date().toISOString()
    });

    console.log('[Background] URLs synced:', urls);
    return urls;

  } catch (error) {
    console.error('[Background] Failed to sync URLs:', error.message);
    return null;
  }
}

/**
 * Health check mirrors and return the fastest working one
 * Tests up to 3 mirrors simultaneously with timeout
 */
async function getBestMirror(urls) {
  if (!urls || urls.length === 0) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT);

  const checkMirror = async (url) => {
    try {
      // Use HEAD request, no-cors to avoid CORS issues
      await fetch(url, { 
        method: 'HEAD', 
        mode: 'no-cors',
        signal: controller.signal,
        cache: 'no-store'
      });
      return url;
    } catch (e) {
      throw new Error(`Mirror failed: ${url}`);
    }
  };

  try {
    // Race the first 3 mirrors
    const fastest = await Promise.any(
      urls.slice(0, 3).map(checkMirror)
    );
    
    clearTimeout(timeoutId);
    console.log('[Background] Fastest mirror:', fastest);
    return fastest;

  } catch (e) {
    clearTimeout(timeoutId);
    // All mirrors failed, return first one as last resort
    console.warn('[Background] All health checks failed, using first mirror');
    return urls[0];
  }
}

/**
 * Get the effective URL based on priority:
 * 1. Custom URL (user-defined) - health check it first
 * 2. Last active URL (if recently verified)
 * 3. Health check remote URLs and pick fastest
 * 4. First remote URL (if health checks fail)
 * @returns {Promise<string|null>} - The effective URL or null if none available
 */
export async function getEffectiveUrl() {
  const storage = await chrome.storage.local.get([
    STORAGE_KEYS.CUSTOM_URL,
    STORAGE_KEYS.REMOTE_URLS,
    STORAGE_KEYS.ACTIVE_URL,
    STORAGE_KEYS.LAST_HEALTH_CHECK
  ]);

  // Priority 1: Custom URL - verify it works
  if (storage[STORAGE_KEYS.CUSTOM_URL]) {
    const customUrl = storage[STORAGE_KEYS.CUSTOM_URL];
    console.log('[Background] Checking custom URL:', customUrl);
    
    const working = await getBestMirror([customUrl]);
    if (working) {
      console.log('[Background] Using verified custom URL');
      return working;
    }
    console.warn('[Background] Custom URL failed health check');
  }

  // Priority 2: Recently verified active URL (within 10 minutes)
  const lastCheck = storage[STORAGE_KEYS.LAST_HEALTH_CHECK];
  const recentlyChecked = lastCheck && (Date.now() - new Date(lastCheck).getTime() < 10 * 60 * 1000);
  
  if (recentlyChecked && storage[STORAGE_KEYS.ACTIVE_URL]) {
    console.log('[Background] Using recently verified active URL');
    return storage[STORAGE_KEYS.ACTIVE_URL];
  }

  // Priority 3: Health check remote URLs
  const remoteUrls = storage[STORAGE_KEYS.REMOTE_URLS];
  if (remoteUrls && remoteUrls.length > 0) {
    const best = await getBestMirror(remoteUrls);
    
    if (best) {
      // Cache the working URL
      await chrome.storage.local.set({
        [STORAGE_KEYS.ACTIVE_URL]: best,
        [STORAGE_KEYS.LAST_HEALTH_CHECK]: new Date().toISOString()
      });
      return best;
    }
  }

  console.error('[Background] No working URLs available');
  return null;
}

/**
 * Initialize extension on install
 */
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[Background] Extension installed:', details.reason);

  // Create alarm for periodic sync
  await chrome.alarms.create(SYNC_ALARM_NAME, {
    periodInMinutes: SYNC_INTERVAL_MINUTES
  });

  // Immediate sync
  const urls = await syncUrlsFromWorker();
  if (urls) {
    // Pre-emptively find best mirror
    await getEffectiveUrl();
  }

  // Open options page on first installation
  if (details.reason === 'install') {
    chrome.runtime.openOptionsPage();
  }

  console.log('[Background] Initialization complete');
});

/**
 * Handle alarm events
 */
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === SYNC_ALARM_NAME) {
    console.log('[Background] Periodic sync triggered');
    const urls = await syncUrlsFromWorker();
    if (urls) {
      // Refresh active URL in background
      chrome.storage.local.remove([STORAGE_KEYS.ACTIVE_URL, STORAGE_KEYS.LAST_HEALTH_CHECK]);
    }
  }
});

/**
 * Handle messages from content scripts or options page
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    try {
      switch (request.action) {
        case 'getEffectiveUrl':
          const url = await getEffectiveUrl();
          sendResponse({ success: !!url, url });
          break;

        case 'syncNow':
          const urls = await syncUrlsFromWorker();
          if (urls) {
            const best = await getBestMirror(urls);
            sendResponse({ success: !!best, urls: urls, active: best });
          } else {
            sendResponse({ success: false, error: 'Sync failed' });
          }
          break;

        case 'getStorageInfo':
          const storage = await chrome.storage.local.get([
            STORAGE_KEYS.CUSTOM_URL,
            STORAGE_KEYS.REMOTE_URLS,
            STORAGE_KEYS.ACTIVE_URL,
            STORAGE_KEYS.LAST_SYNC,
            STORAGE_KEYS.LAST_HEALTH_CHECK
          ]);
          sendResponse({
            success: true,
            customUrl: storage[STORAGE_KEYS.CUSTOM_URL] || null,
            remoteUrls: storage[STORAGE_KEYS.REMOTE_URLS] || [],
            activeUrl: storage[STORAGE_KEYS.ACTIVE_URL] || null,
            lastSync: storage[STORAGE_KEYS.LAST_SYNC] || null,
            lastHealthCheck: storage[STORAGE_KEYS.LAST_HEALTH_CHECK] || null
          });
          break;

        case 'setCustomUrl':
          if (request.url) {
            await chrome.storage.local.set({ [STORAGE_KEYS.CUSTOM_URL]: request.url });
            // Clear active to force re-check
            await chrome.storage.local.remove([STORAGE_KEYS.ACTIVE_URL, STORAGE_KEYS.LAST_HEALTH_CHECK]);
            sendResponse({ success: true });
          } else {
            await chrome.storage.local.remove(STORAGE_KEYS.CUSTOM_URL);
            sendResponse({ success: true, cleared: true });
          }
          break;

        default:
          sendResponse({ success: false, error: 'Unknown action' });
      }
    } catch (error) {
      console.error('[Background] Message handler error:', error.message);
      sendResponse({ success: false, error: error.message });
    }
  })();

  return true;
});

export { WORKER_URL, syncUrlsFromWorker, getBestMirror };
