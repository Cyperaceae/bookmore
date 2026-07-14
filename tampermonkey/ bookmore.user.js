// ==UserScript==
// @name         Book More
// @namespace    https://example.com/
// @version      2.2.0
// @description  Adds quick-access buttons for Anna's Archive and Libby on Douban, NeoDb, Goodreads, and StoryGraph. Settings panel included.
// @author       cccccc
// @match        https://neodb.social/book/*
// @match        https://book.douban.com/subject/*
// @match        https://www.goodreads.com/book/*
// @match        https://app.thestorygraph.com/books/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_setClipboard
// @grant        GM_registerMenuCommand
// @connect      tiny-leaf-4d57.cccccccccccc.workers.dev
// @icon         https://lh3.googleusercontent.com/Ka5TAf3UA4d-oZrv2ZazRgnTMtpl-aObXXZmp2pL9D8MTYiCUK-IF_8l4Joczf0JP0d_IJAWFK3Qs5DvNDzB5_I3JQ=s120
// @license      GPL-3.0-only
// ==/UserScript==
 
(function () {
  'use strict';
 
  const WORKER_URL = 'https://tiny-leaf-4d57.cccccccccccc.workers.dev/';
  const STORAGE_KEYS = {
    REMOTE_URLS: 'remoteUrls',
    CUSTOM_URL: 'customUrl',
    LAST_SYNC: 'lastSync',
    INSTALLED_VERSION: 'installedVersion',
  };
 
  const CURRENT_VERSION = '2.1.0';
  const SYNC_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
 
  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------
 
  /** Escape a string for safe insertion into HTML attribute or text content. */
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
 
  /** Read and parse the stored remote URL array; returns [] on any failure. */
  function getStoredUrls() {
    try {
      return JSON.parse(GM_getValue(STORAGE_KEYS.REMOTE_URLS)) || [];
    } catch (_) {
      return [];
    }
  }
 
  // ---------------------------------------------------------------------------
  // Worker sync
  // ---------------------------------------------------------------------------
 
  /**
   * Fetch the latest mirror list from the Cloudflare Worker.
   *
   * @param {object} [opts]
   * @param {boolean} [opts.diffOnly=false]
   *   When true, only write to storage if the remote list differs from the
   *   locally cached one (smart-sync behaviour). The timestamp is always
   *   updated on a successful fetch so the 3-day interval resets.
   * @returns {Promise<string[]|null>} The fresh URL array, or null on failure.
   */
  async function syncUrlsFromWorker({ diffOnly = false } = {}) {
    console.log('[Book More] Syncing URLs from Worker...');
 
    const response = await new Promise((resolve) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url: WORKER_URL,
        headers: { Accept: 'application/json' },
        timeout: 5000,
        onload: resolve,
        onerror: () => resolve(null),
      });
    });
 
    if (!response || response.status !== 200) {
      console.warn('[Book More] Sync failed: Worker returned', response?.status ?? 'no response');
      return null;
    }
 
    let remoteUrls;
    try {
      const data = JSON.parse(response.responseText);
      remoteUrls = data.urls ?? (data.url ? [data.url] : null);
    } catch (_) {
      console.error('[Book More] Sync failed: Invalid JSON from Worker');
      return null;
    }
 
    if (!Array.isArray(remoteUrls) || remoteUrls.length === 0) {
      console.warn('[Book More] Sync failed: No URLs in Worker response');
      return null;
    }
 
    // Always update the timestamp so the interval resets on a successful fetch.
    GM_setValue(STORAGE_KEYS.LAST_SYNC, new Date().toISOString());
 
    if (diffOnly) {
      const localJson = JSON.stringify([...getStoredUrls()].sort());
      const remoteJson = JSON.stringify([...remoteUrls].sort());
      if (localJson === remoteJson) {
        console.log('[Book More] Smart sync: mirrors unchanged');
        return remoteUrls;
      }
      console.log('[Book More] Smart sync: mirrors updated');
    }
 
    GM_setValue(STORAGE_KEYS.REMOTE_URLS, JSON.stringify(remoteUrls));
    console.log('[Book More] URLs stored:', remoteUrls);
    return remoteUrls;
  }
 
  /**
   * Return the URL to use for Anna's Archive searches.
   * Priority: custom URL → first cached remote URL → fresh sync.
   */
  async function getEffectiveUrl() {
    const customUrl = GM_getValue(STORAGE_KEYS.CUSTOM_URL);
    if (customUrl) return customUrl;
 
    const cached = getStoredUrls();
    if (cached.length > 0) return cached[0];
 
    console.log('[Book More] No cached URLs, attempting immediate sync...');
    const fresh = await syncUrlsFromWorker();
    return fresh?.[0] ?? null;
  }
 
  // ---------------------------------------------------------------------------
  // Auto-sync on page load
  // ---------------------------------------------------------------------------
 
  (async () => {
    const lastSync = GM_getValue(STORAGE_KEYS.LAST_SYNC);
    const lastSyncTime = lastSync ? new Date(lastSync).getTime() : 0;
 
    if (!lastSync) {
      console.log('[Book More] First run – syncing immediately');
      await syncUrlsFromWorker();
    } else if (Date.now() - lastSyncTime > SYNC_INTERVAL_MS) {
      console.log('[Book More] 3+ days since last sync – running smart sync');
      await syncUrlsFromWorker({ diffOnly: true });
    } else {
      const hoursLeft = Math.ceil((SYNC_INTERVAL_MS - (Date.now() - lastSyncTime)) / 36e5);
      console.log(`[Book More] Next auto-sync in ~${hoursLeft} h`);
    }
  })();
 
  // ---------------------------------------------------------------------------
  // Book data extraction
  // ---------------------------------------------------------------------------
 
  function extractBookData() {
    const script = document.querySelector('script[type="application/ld+json"]');
    if (!script) return { title: '', isbn: '' };
 
    let data;
    try {
      data = JSON.parse(script.textContent.trim());
    } catch (_) {
      return { title: '', isbn: '' };
    }
 
    if (Array.isArray(data)) {
      data = data.find((x) => x['@type'] === 'Book') ?? data[0] ?? {};
    }
 
    // Decode HTML entities that may appear in JSON-LD title strings.
    const textarea = document.createElement('textarea');
    textarea.innerHTML = data.name ?? data.title ?? '';
    const title = textarea.value;
 
    const isbn = (data.isbn ?? '').replace(/-/g, '');
    return { title, isbn };
  }
 
  // ---------------------------------------------------------------------------
  // URL construction
  // ---------------------------------------------------------------------------
 
  function buildSearchUrls(baseUrl, title, isbn) {
    const base = baseUrl.replace(/\/$/, '');
    return {
      annaIsbn: isbn ? `${base}/search?q=${encodeURIComponent(isbn)}` : null,
      annaTitle: title ? `${base}/search?q=${encodeURIComponent(title)}` : null,
    };
  }
 
  // ---------------------------------------------------------------------------
  // DOM helpers
  // ---------------------------------------------------------------------------
 
  function applyHover(btn, bg, hoverBg, color, hoverColor) {
    btn.addEventListener('mouseenter', () => {
      btn.style.backgroundColor = hoverBg;
      btn.style.color = hoverColor;
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.backgroundColor = bg;
      btn.style.color = color;
    });
  }
 
  function makeButton(label, href, buttonClass, hoverFn) {
    const a = document.createElement('a');
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = label;
    a.className = buttonClass;
    hoverFn?.(a);
    return a;
  }
 
  function makeLibbyButton(title, buttonClass, hoverFn) {
    const btn = document.createElement('a');
    btn.href = '#';
    btn.textContent = 'Libby';
    btn.className = buttonClass;
    hoverFn?.(btn);
 
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        GM_setClipboard(title, 'text');
        console.log('[Book More] Title copied to clipboard');
      } catch (err) {
        console.error('[Book More] Clipboard write failed:', err);
      }
      window.open('https://libbyapp.com/search', '_blank', 'noopener');
    });
 
    return btn;
  }
 
  // ---------------------------------------------------------------------------
  // CSS injection (idempotent)
  // ---------------------------------------------------------------------------
 
  function injectCSS() {
    if (document.getElementById('book-more-styles')) return;
 
    const style = document.createElement('style');
    style.id = 'book-more-styles';
    style.textContent = `
      .bm-btn-neodb {
        display: block;
        width: 75%;
        margin: 0.3rem auto;
        padding: 0.5rem 1rem;
        font-size: 0.9rem;
        text-align: center;
        border-radius: 4px;
        border: 1px solid var(--pico-primary-border);
        background: transparent;
        color: var(--pico-primary);
        text-decoration: none;
        cursor: pointer;
      }
      .bm-btn-douban {
        text-decoration: none;
        cursor: pointer;
      }
      .bm-btn-goodreads {
        display: inline-block;
        margin: 0.3rem;
        padding: 0.4rem 0.8rem;
        font-size: 0.85rem;
        border-radius: 4px;
        border: 1px solid #d0d0ce;
        background: #f5f5f1;
        color: #333;
        text-decoration: none;
        cursor: pointer;
      }
      .bm-btn-storygraph {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0.35rem 0.65rem;
        font-size: 12px;
        font-weight: 600;
        border-radius: 4px;
        border: 1px solid #d1d5db;
        background: transparent;
        color: #374151;
        text-decoration: none;
        cursor: pointer;
        transition: background 0.15s;
        white-space: nowrap;
      }
      @media (prefers-color-scheme: dark) {
        .bm-btn-storygraph {
          border-color: #4b5563;
          color: #e5e7eb;
        }
        .bm-btn-storygraph:hover {
          background: #374151 !important;
          color: #f9fafb !important;
        }
      }
      @media (max-width: 600px) {
        #book-more-links {
          justify-content: center !important;
        }
        .bm-btn-neodb,
        .bm-btn-goodreads,
        .bm-btn-storygraph {
          flex: 1 1 auto;
          text-align: center;
        }
      }
 
      /* Settings modal */
      .bm-settings-modal {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: white;
        border: 1px solid #ddd;
        border-radius: 8px;
        padding: 2rem;
        z-index: 10000;
        box-shadow: 0 4px 12px rgba(0,0,0,.15);
        max-width: 500px;
        width: 90%;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      .bm-settings-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,.5);
        z-index: 9999;
      }
      .bm-settings-modal h2 {
        margin-top: 0;
        color: #333;
        border-bottom: 2px solid #3498db;
        padding-bottom: 0.5rem;
      }
      .bm-settings-group   { margin-bottom: 1.5rem; }
      .bm-settings-label   { display: block; font-weight: 500; color: #555; margin-bottom: 0.5rem; }
      .bm-settings-input {
        width: 100%;
        padding: 0.75rem;
        border: 1px solid #ddd;
        border-radius: 4px;
        font-size: 1rem;
        font-family: monospace;
        box-sizing: border-box;
      }
      .bm-settings-input:focus {
        outline: none;
        border-color: #3498db;
        box-shadow: 0 0 0 3px rgba(52,152,219,.1);
      }
      .bm-settings-info {
        background: #f8f9fa;
        border-left: 4px solid #3498db;
        padding: 0.75rem;
        margin-top: 0.5rem;
        border-radius: 0 4px 4px 0;
        font-size: 0.9rem;
        color: #555;
      }
      .bm-settings-list {
        background: #f8f9fa;
        border: 1px solid #ddd;
        border-radius: 4px;
        padding: 0.75rem;
        max-height: 150px;
        overflow-y: auto;
        margin-bottom: 1rem;
      }
      .bm-settings-list-item {
        padding: 0.5rem;
        border-bottom: 1px solid #eee;
        font-family: monospace;
        font-size: 0.85rem;
        word-break: break-all;
      }
      .bm-settings-list-item:last-child { border-bottom: none; }
      .bm-settings-buttons {
        display: flex;
        gap: 0.75rem;
        margin-top: 1.5rem;
      }
      .bm-btn {
        flex: 1;
        padding: 0.75rem;
        border: none;
        border-radius: 4px;
        font-size: 1rem;
        cursor: pointer;
        transition: background 0.2s;
      }
      .bm-btn-primary   { background: #3498db; color: white; }
      .bm-btn-primary:hover   { background: #2980b9; }
      .bm-btn-secondary { background: #95a5a6; color: white; }
      .bm-btn-secondary:hover { background: #7f8c8d; }
      .bm-btn-success   { background: #27ae60; color: white; }
      .bm-btn-success:hover   { background: #229954; }
      .bm-status-message {
        padding: 0.75rem;
        border-radius: 4px;
        margin-bottom: 1rem;
        display: none;
      }
      .bm-status-message.success {
        display: block;
        background: #d4edda;
        color: #155724;
        border: 1px solid #c3e6cb;
      }
      .bm-status-message.error {
        display: block;
        background: #f8d7da;
        color: #721c24;
        border: 1px solid #f5c6cb;
      }
    `;
    document.head.appendChild(style);
  }
 
  // ---------------------------------------------------------------------------
  // Site configuration
  // ---------------------------------------------------------------------------
 
  const siteConfig = {
    neodb: {
      match: /^https:\/\/neodb\.social\/book\//,
      insertTarget() {
        const anchor = document.querySelector('.right.mark');
        return { parent: anchor?.parentNode, before: anchor };
      },
      container(el) {
        el.id = 'book-more-links';
        el.style.cssText = `
          float: right; clear: right; width: 25%;
          margin: 2rem 0; text-align: center;
        `;
      },
      buttonClass: 'bm-btn-neodb',
      hover: (btn) =>
        applyHover(
          btn,
          'transparent', 'var(--pico-primary-hover-background)',
          'var(--pico-primary)', 'var(--pico-primary-inverse)'
        ),
    },
 
    douban: {
      match: /^https:\/\/book\.douban\.com\/subject\//,
      insertTarget() {
        const aside = document.querySelector('.subjectwrap .aside') ||
          document.querySelector('.aside');
        return { parent: aside, before: aside?.firstChild };
      },
      container(el) {
        el.className = 'gray_ad no-border';
      },
      wrapper() {
        const w = document.createElement('div');
        w.className = 'mb8 pl';
        return w;
      },
      buttonWrapper(btn) {
        const meta = document.createElement('div');
        meta.className = 'meta';
        meta.appendChild(btn);
        return meta;
      },
      buttonClass: 'bm-btn-douban',
    },
 
    goodreads: {
      match: /^https:\/\/www\.goodreads\.com\/book\//,
      insertTarget() {
        const h = document.querySelector('#bookTitle') ||
          document.querySelector('h1');
        return { parent: h?.parentNode, before: h };
      },
      container(el) {
        el.id = 'book-more-links';
        el.style.cssText = `
          margin: 1rem 0; padding: 0.5rem 0;
          display: flex; flex-wrap: wrap; gap: 0.5rem;
        `;
      },
      buttonClass: 'bm-btn-goodreads',
      hover: (btn) => applyHover(btn, '#f5f5f1', '#ddd', '#333', '#333'),
    },
 
    storygraph: {
      match: /^https:\/\/app\.thestorygraph\.com\/books\//,
      responsive: true,
      selectors: '.book-title-author-and-series',
      extractData() {
        const titleEl = document.querySelector('.book-title-author-and-series h3') ||
          document.querySelector('h3.font-semibold');
        const title = titleEl ? titleEl.textContent.trim() : '';
 
        let isbn = '';
        const editionInfo = document.querySelector('.edition-info');
        if (editionInfo) {
          const firstP = editionInfo.querySelector('p:first-child');
          if (firstP) {
            const raw = firstP.textContent.replace(/ISBN\/UID\s*:/i, '').replace(/-/g, '').trim();
            if (/^\d{10}$|^\d{13}$/.test(raw)) {
              isbn = raw;
            }
          }
        }
        return { title, isbn };
      },
      insertTarget() {
        const containers = document.querySelectorAll(this.selectors);
        const activeContainer = Array.from(containers).find(el => el.offsetParent !== null) || containers[0];
        return { parent: activeContainer, before: activeContainer?.firstChild };
      },
      container(el) {
        el.id = 'book-more-links';
        el.style.cssText = `
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
          margin-bottom: 1rem;
          width: 100%;
          position: relative;
          z-index: 50;
        `;
      },
      buttonClass: 'bm-btn-storygraph',
      hover: (btn) => applyHover(btn, 'transparent', '#e5e7eb', '#374151', '#374151'),
    },
  };
 
  // ---------------------------------------------------------------------------
  // Responsive migration helper for SPA navigation
  // ---------------------------------------------------------------------------
 
  /**
   * Handle responsive migration of the button container on window resize.
   * Essential for StoryGraph's responsive layout changes.
   * @param {HTMLElement} container - The button container element
   * @param {string} selectors - CSS selector for finding the target container
   */
  function handleResponsiveMigration(container, selectors) {
    const migrate = () => {
      const targets = document.querySelectorAll(selectors);
      const visibleTarget = Array.from(targets).find(el => el.offsetParent !== null);
      if (visibleTarget && !visibleTarget.contains(container)) {
        visibleTarget.insertBefore(container, visibleTarget.firstChild);
      }
    };
    let timer;
    window.addEventListener('resize', () => {
      clearTimeout(timer);
      timer = setTimeout(migrate, 150);
    });
  }
 
  // ---------------------------------------------------------------------------
  // Settings modal
  // ---------------------------------------------------------------------------
 
  /** Render the remote-URL list into the given container element. */
  function renderUrlList(listEl, urls) {
    listEl.replaceChildren(); // clear
    if (urls.length === 0) {
      const item = document.createElement('div');
      item.className = 'bm-settings-list-item';
      item.style.color = '#999';
      item.textContent = 'Not synced';
      listEl.appendChild(item);
    } else {
      urls.forEach((url) => {
        const item = document.createElement('div');
        item.className = 'bm-settings-list-item';
        item.textContent = url; // textContent is always safe
        listEl.appendChild(item);
      });
    }
  }
 
  function showSettingsModal() {
    // Prevent duplicate modals
    if (document.getElementById('bm-settings-modal')) return;
 
    const customUrl = GM_getValue(STORAGE_KEYS.CUSTOM_URL) || '';
    const remoteUrls = getStoredUrls();
    const lastSync = GM_getValue(STORAGE_KEYS.LAST_SYNC);
    const syncTime = lastSync ? new Date(lastSync).toLocaleString() : 'Never';
 
    const overlay = document.createElement('div');
    overlay.className = 'bm-settings-overlay';
 
    const modal = document.createElement('div');
    modal.id = 'bm-settings-modal';
    modal.className = 'bm-settings-modal';
 
    // Build modal structure with DOM API to avoid any injection risk
    modal.innerHTML = `
      <h2>⚙️ Book More Settings</h2>
 
      <div class="bm-settings-group">
        <label class="bm-settings-label" for="bm-custom-url">Custom URL (Priority)</label>
        <input type="url" id="bm-custom-url" class="bm-settings-input" placeholder="https://...">
        <div class="bm-settings-info">Leave empty to use remote mirrors. Custom URL takes priority.</div>
      </div>
 
      <div class="bm-settings-group">
        <label class="bm-settings-label">Remote Mirrors (<span id="bm-mirror-count">${remoteUrls.length}</span>)</label>
        <div class="bm-settings-list" id="bm-remote-list"></div>
      </div>
 
      <div class="bm-settings-group">
        <label class="bm-settings-label">Last Sync</label>
        <div class="bm-settings-info" id="bm-sync-time"></div>
      </div>
 
      <div id="bm-status-message" class="bm-status-message"></div>
 
      <div class="bm-settings-buttons">
        <button id="bm-sync-btn"  class="bm-btn bm-btn-success">Sync Now</button>
        <button id="bm-save-btn"  class="bm-btn bm-btn-primary">Save</button>
        <button id="bm-reset-btn" class="bm-btn bm-btn-secondary">Reset</button>
        <button id="bm-close-btn" class="bm-btn bm-btn-secondary">Close</button>
      </div>
    `;
 
    document.body.appendChild(overlay);
    document.body.appendChild(modal);
 
    // Populate fields that contain user/remote data safely
    modal.querySelector('#bm-custom-url').value = customUrl;
    modal.querySelector('#bm-sync-time').textContent = syncTime;
    renderUrlList(modal.querySelector('#bm-remote-list'), remoteUrls);
 
    // ---- helpers ----
    const statusEl = modal.querySelector('#bm-status-message');
    let statusTimer;
    const showStatus = (message, isError = false) => {
      clearTimeout(statusTimer);
      statusEl.textContent = message;
      statusEl.className = `bm-status-message ${isError ? 'error' : 'success'}`;
      statusTimer = setTimeout(() => { statusEl.className = 'bm-status-message'; }, 3000);
    };
 
    const closeModal = () => { overlay.remove(); modal.remove(); };
 
    // ---- Sync Now ----
    modal.querySelector('#bm-sync-btn').addEventListener('click', async () => {
      const btn = modal.querySelector('#bm-sync-btn');
      btn.disabled = true;
      btn.textContent = 'Syncing…';
      try {
        const freshUrls = await syncUrlsFromWorker();
        if (!freshUrls) {
          showStatus('Sync failed: Worker unavailable', true);
          return;
        }
 
        const localUrls = getStoredUrls(); // already updated by syncUrlsFromWorker
        const changed = JSON.stringify([...localUrls].sort()) !== JSON.stringify([...freshUrls].sort());
 
        renderUrlList(modal.querySelector('#bm-remote-list'), freshUrls);
        modal.querySelector('#bm-mirror-count').textContent = freshUrls.length;
        modal.querySelector('#bm-sync-time').textContent = new Date().toLocaleString();
 
        showStatus(
          changed
            ? `✓ Updated: ${freshUrls.length} mirror(s) synced!`
            : `✓ Verified: ${freshUrls.length} mirror(s) unchanged`
        );
      } catch (err) {
        showStatus('Sync error: ' + err.message, true);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Sync Now';
      }
    });
 
    // ---- Save ----
    modal.querySelector('#bm-save-btn').addEventListener('click', () => {
      const url = modal.querySelector('#bm-custom-url').value.trim();
      if (url) {
        try {
          new URL(url); // validate format
          if (!url.startsWith('https://')) {
            showStatus('URL must use HTTPS', true);
            return;
          }
          GM_setValue(STORAGE_KEYS.CUSTOM_URL, url);
          showStatus('Custom URL saved!');
        } catch (_) {
          showStatus('Invalid URL format', true);
        }
      } else {
        GM_setValue(STORAGE_KEYS.CUSTOM_URL, '');
        showStatus('Custom URL cleared');
      }
    });
 
    // ---- Reset ----
    modal.querySelector('#bm-reset-btn').addEventListener('click', () => {
      if (confirm('Reset all settings to default?')) {
        GM_setValue(STORAGE_KEYS.CUSTOM_URL, '');
        modal.querySelector('#bm-custom-url').value = '';
        showStatus('Settings reset');
      }
    });
 
    modal.querySelector('#bm-close-btn').addEventListener('click', closeModal);
    overlay.addEventListener('click', closeModal);
  }
 
  // ---------------------------------------------------------------------------
  // First-run / upgrade banner
  // ---------------------------------------------------------------------------
 
  function showSettingsAwarenessBanner() {
    if (GM_getValue(STORAGE_KEYS.INSTALLED_VERSION) === CURRENT_VERSION) return;
 
    const banner = document.createElement('div');
    banner.id = 'book-more-awareness-banner';
    banner.textContent = 'Book More settings: Tampermonkey menu → ⚙️ Book More Settings';
    banner.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0;
      padding: 4px 12px; font-size: 12px;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      color: #666; background: #f5f5f5;
      border-bottom: 1px solid #ddd;
      z-index: 9999; text-align: center; line-height: 1.4;
    `;
    document.body.appendChild(banner);
    setTimeout(() => banner.isConnected && banner.remove(), 5000);
 
    const prev = GM_getValue(STORAGE_KEYS.INSTALLED_VERSION);
    GM_setValue(STORAGE_KEYS.INSTALLED_VERSION, CURRENT_VERSION);
    console.log(`[Book More] Updated from ${prev ?? 'none'} to ${CURRENT_VERSION}`);
  }
 
  // ---------------------------------------------------------------------------
  // SPA navigation handler
  // ---------------------------------------------------------------------------
 
  /**
   * Handle SPA navigation by observing URL changes.
   * Essential for StoryGraph's client-side routing.
   */
  function handleRouting() {
    let lastUrl = location.href;
    const observer = new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        // Small delay to ensure the new page content has started rendering
        setTimeout(init, 500);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
 
  // ---------------------------------------------------------------------------
  // Main init
  // ---------------------------------------------------------------------------
 
  async function init() {
    const active = Object.values(siteConfig).find((cfg) => cfg.match.test(location.href));
    if (!active) return;
 
    // Check if buttons already exist to prevent duplicates on navigation
    if (document.getElementById('book-more-links')) return;
 
    injectCSS();
 
    const { title, isbn } = active.extractData ? active.extractData() : extractBookData();
    if (!title) return;
 
    const effectiveUrl = await getEffectiveUrl();
    if (!effectiveUrl) {
      console.error('[Book More] No Anna\'s Archive URL available');
      return;
    }
 
    const links = buildSearchUrls(effectiveUrl, title, isbn);
 
    const container = document.createElement('div');
    active.container(container);
 
    const wrapper = active.wrapper ? active.wrapper() : container;
 
    const addBtn = (el) => {
      const node = active.buttonWrapper ? active.buttonWrapper(el) : el;
      wrapper.appendChild(node);
    };
 
    if (links.annaIsbn)
      addBtn(makeButton('Anna (ISBN)', links.annaIsbn, active.buttonClass, active.hover));
    if (links.annaTitle)
      addBtn(makeButton('Anna (Title)', links.annaTitle, active.buttonClass, active.hover));
    addBtn(makeLibbyButton(title, active.buttonClass, active.hover));
 
    if (wrapper !== container) container.appendChild(wrapper);
 
    const { parent, before } = active.insertTarget();
    parent?.insertBefore(container, before);
 
    // Enable responsive migration for sites that need it (StoryGraph)
    if (active.responsive && active.selectors) {
      handleResponsiveMigration(container, active.selectors);
    }
  }
 
  // ---------------------------------------------------------------------------
  // Menu commands
  // ---------------------------------------------------------------------------
 
  GM_registerMenuCommand('⚙️ Book More Settings', showSettingsModal);
  GM_registerMenuCommand('🔄 Sync URLs Now', async () => {
    const urls = await syncUrlsFromWorker();
    console.log(`[Book More] Manual sync: ${urls ? urls.length + ' mirror(s)' : 'failed'}`);
  });
 
  // ---------------------------------------------------------------------------
  // Bootstrap
  // ---------------------------------------------------------------------------
 
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      showSettingsAwarenessBanner();
      init();
    });
  } else {
    showSettingsAwarenessBanner();
    init();
  }
 
  // Listen for SPA route changes
  handleRouting();
})();