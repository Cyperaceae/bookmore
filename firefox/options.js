/**
 * Firefox Options Page Script - Book More Extension
*/

// Define required data-element keys for verification
const REQUIRED_KEYS = [
  'activeUrl', 'customUrl', 'remoteUrls', 'remoteUrlList', 'lastSync',
  'lastHealthCheck', 'customUrlInput', 'saveBtn', 'resetBtn', 'syncBtn',
  'statusMessage', 'priorityCustom', 'priorityRemote'
];

/**
 * Automatically find elements with [data-element] attributes
 */
const elements = (() => {
  const obj = {};
  document.querySelectorAll('[data-element]').forEach(el => {
    obj[el.dataset.element] = el;
  });

  // Simple integrity check
  REQUIRED_KEYS.forEach(key => {
    if (!obj[key]) console.warn(`Missing UI element: data-element="${key}"`);
  });
  
  return obj;
})();

/**
 * Display status message
 */
function showStatus(message, isError = false) {
  if (!elements.statusMessage) return;
  elements.statusMessage.textContent = message;
  elements.statusMessage.className = `status-message ${isError ? 'error' : 'success'}`;

  setTimeout(() => {
    elements.statusMessage.className = 'status-message';
  }, 5000);
}

/**
 * Update priority list highlighting
 */
function updatePriorityHighlight(source) {
  const isCustom = source === 'custom';
  elements.priorityCustom?.classList.toggle('current', isCustom);
  elements.priorityRemote?.classList.toggle('current', !isCustom);
}

/**
 * Render remote URLs list
 */
function renderRemoteUrls(urls, activeUrl) {
  if (!elements.remoteUrlList || !elements.remoteUrls) return;

// Clear the list first
elements.remoteUrlList.replaceChildren();

if (!urls || urls.length === 0) {
  const li = document.createElement('li');
  li.className = 'url-item';
  
  const span = document.createElement('span');
  span.className = 'url-text';
  span.textContent = 'Not synced';
  
  li.appendChild(span);
  elements.remoteUrlList.appendChild(li);
  elements.remoteUrls.className = 'info-value inactive';
  return;
}

// Populate the list safely
urls.forEach(url => {
  const isActive = url === activeUrl;
  
  const li = document.createElement('li');
  li.className = `url-item ${isActive ? 'best' : ''}`;

  const textSpan = document.createElement('span');
  textSpan.className = 'url-text';
  textSpan.textContent = url; // Safely handles the URL string
  li.appendChild(textSpan);

  if (isActive) {
    const badge = document.createElement('span');
    badge.className = 'best-badge';
    badge.textContent = '★ Best';
    li.appendChild(badge);
  }

  elements.remoteUrlList.appendChild(li);
});

  elements.remoteUrls.className = 'info-value active';
}

/**
 * Load and display current configuration
 */
async function loadConfiguration() {
  try {
    const response = await browser.runtime.sendMessage({ action: 'getStorageInfo' });
    if (!response.success) throw new Error(response.error || 'Failed to load configuration');

    // Update Text Content
    if (elements.customUrl) {
      elements.customUrl.textContent = response.customUrl || 'Not set';
      elements.customUrl.className = 'info-value ' + (response.customUrl ? 'active' : 'inactive');
    }

    renderRemoteUrls(response.remoteUrls, response.activeUrl);

    if (elements.lastSync) 
      elements.lastSync.textContent = response.lastSync ? new Date(response.lastSync).toLocaleString() : 'Never';
    
    if (elements.lastHealthCheck)
      elements.lastHealthCheck.textContent = response.lastHealthCheck ? new Date(response.lastHealthCheck).toLocaleString() : 'Never';

    // Logic for determining source
    let activeUrl = response.activeUrl;
    let source = (response.customUrl && activeUrl === response.customUrl) ? 'custom' : 'remote';

    if (!activeUrl && response.remoteUrls?.length > 0) activeUrl = response.remoteUrls[0];

    if (elements.activeUrl) {
      elements.activeUrl.textContent = activeUrl || 'None available';
      elements.activeUrl.className = 'info-value ' + (activeUrl ? 'active' : 'inactive');
    }
    
    updatePriorityHighlight(source);

    if (elements.customUrlInput && response.customUrl) {
      elements.customUrlInput.value = response.customUrl;
    }

    // Auto-sync if not synced yet (on first options page load)
    if (!response.remoteUrls || response.remoteUrls.length === 0) {
      console.log('[Options] No remote URLs found. Performing automatic first-time sync...');
      await syncNow();
    }
  } catch (error) {
    showStatus(error.message, true);
  }
}

/**
 * Event Handlers
 */
async function saveCustomUrl() {
  const url = elements.customUrlInput?.value.trim();
  if (!url) return showStatus('Please enter a valid URL', true);

  try {
    const urlObj = new URL(url);
    if (urlObj.protocol !== 'https:') return showStatus('URL must use HTTPS protocol', true);

    await browser.runtime.sendMessage({ action: 'setCustomUrl', url });
    showStatus('Custom URL saved successfully!');
    await loadConfiguration();
  } catch (err) {
    showStatus('Invalid URL format', true);
  }
}

async function resetToDefault() {
  try {
    await browser.runtime.sendMessage({ action: 'setCustomUrl', url: null });
    if (elements.customUrlInput) elements.customUrlInput.value = '';
    showStatus('Reset to default.');
    await loadConfiguration();
  } catch (error) {
    showStatus('Reset failed: ' + error.message, true);
  }
}

async function syncNow() {
  if (!elements.syncBtn) return;
  const btn = elements.syncBtn;
  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = 'Syncing...';

  try {
    const response = await browser.runtime.sendMessage({ action: 'syncNow' });
    if (!response.success) throw new Error(response.error || 'Sync failed');
    showStatus(`Synced! Found ${response.urls?.length || 0} mirrors.`);
    await loadConfiguration();
  } catch (error) {
    showStatus(error.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

// Bind Listeners
const init = () => {
  elements.saveBtn?.addEventListener('click', saveCustomUrl);
  elements.resetBtn?.addEventListener('click', resetToDefault);
  elements.syncBtn?.addEventListener('click', syncNow);
  elements.customUrlInput?.addEventListener('keypress', (e) => e.key === 'Enter' && saveCustomUrl());
  
  loadConfiguration();
};

document.addEventListener('DOMContentLoaded', init);
