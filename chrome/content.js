(function () {
  'use strict';

  function cleanTitle(title) {
    if (!title) return '';
    let cleaned = title;
    if (cleaned.includes('%')) {
      try {
        cleaned = decodeURIComponent(cleaned);
      } catch (_) {}
    }
    return cleaned.replace(/\s+/g, ' ').trim();
  }

  function decodeHtml(html) {
    if (!html) return '';
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      return doc.body.textContent || '';
    } catch (_) {
      return html;
    }
  }

  async function getEffectiveUrl() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'getEffectiveUrl' });
      if (response.success && response.url) {
        return response.url;
      }
      return null;
    } catch (error) {
      console.error('[Content] Error requesting effective URL:', error.message);
      return null;
    }
  }

  function buildSearchUrls(baseUrl, title, isbn) {
    const cleanBaseUrl = baseUrl.replace(/\/$/, '');
    return {
      annaIsbn: isbn ? `${cleanBaseUrl}/search?q=${isbn}` : null,
      annaTitle: `${cleanBaseUrl}/search?q=${encodeURIComponent(title)}`,
      libby: 'https://libbyapp.com/search'
    };
  }

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
      data = data.find(x => x['@type'] === 'Book') || data[0] || {};
    }

    const title = cleanTitle(decodeHtml(data.name || data.title || ''));
    const isbn = (data.isbn || '').replace(/-/g, '');
    return { title, isbn };
  }

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
          float: right;
          clear: right;
          width: 25%;
          margin: 2rem 0;
          text-align: center;
        `;
      },
      buttonClass: 'bm-btn-neodb',
      hover: (btn) =>
        applyHover(
          btn,
          'transparent',
          'var(--pico-primary-hover-background)',
          'var(--pico-primary)',
          'var(--pico-primary-inverse)'
        )
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
      buttonClass: 'bm-btn-douban'
    },

    goodreads: {
      match: /^https:\/\/www\.goodreads\.com\/(?:[^/]+\/)?book\//,
      insertTarget() {
        const h = document.querySelector('#bookTitle') ||
                  document.querySelector('h1');
        return { parent: h?.parentNode, before: h };
      },
      container(el) {
        el.id = 'book-more-links';
        el.style.cssText = `
          margin: 1rem 0;
          padding: 0.5rem 0;
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
          width: 100%;
        `;
      },
      buttonClass: 'bm-btn-goodreads',
      hover: (btn) => applyHover(btn, '#f5f5f1', '#ddd', '#333', '#333')
    },

    storygraph: {
      match: /^https:\/\/app\.thestorygraph\.com\/books\//,
      responsive: true,
      selectors: '.book-title-author-and-series',
      extractData() {
        const titleEl = document.querySelector('.book-title-author-and-series h3') || 
                        document.querySelector('h3.font-semibold');
        const title = titleEl ? cleanTitle(titleEl.textContent) : '';

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
      hover: (btn) => applyHover(btn, 'transparent', '#e5e7eb', '#374151', '#374151')
    }
  };

  let active = null;
  function detectSite() {
    active = null;
    for (const key in siteConfig) {
      if (siteConfig[key].match.test(location.href)) {
        active = siteConfig[key];
        break;
      }
    }
    return active;
  }

  const css = `
    .bm-btn-neodb {
      display: block; width: 75%; margin: 0.3rem auto; padding: 0.5rem 1rem;
      font-size: 0.9rem; text-align: center; border-radius: var(--pico-border-radius);
      border: 1px solid var(--pico-primary-border); background: transparent;
      color: var(--pico-primary); text-decoration: none; cursor: pointer;
    }
    .bm-btn-douban { text-decoration: none; cursor: pointer; }
    .bm-btn-goodreads {
      display: inline-block; padding: 0.4rem 0.8rem; font-size: 0.85rem;
      border-radius: 4px; border: 1px solid #d0d0ce; background: #f5f5f1;
      color: #333; text-decoration: none; cursor: pointer; white-space: nowrap;
    }
    .bm-btn-storygraph {
      display: inline-flex; align-items: center; justify-content: center;
      padding: 0.35rem 0.65rem; font-size: 12px; font-weight: 600;
      border-radius: 4px; border: 1px solid #d1d5db; background: transparent;
      color: #374151; text-decoration: none; cursor: pointer;
      transition: background 0.15s; white-space: nowrap;
    }
    @media (prefers-color-scheme: dark) {
      .bm-btn-storygraph { border-color: #4b5563; color: #e5e7eb; }
      .bm-btn-storygraph:hover { background: #374151 !important; color: #f9fafb !important; }
    }
    @media (max-width: 600px) {
      #book-more-links { justify-content: center !important; }
      .bm-btn-neodb, .bm-btn-goodreads, .bm-btn-storygraph { flex: 1 1 auto; text-align: center; }
    }
  `;

  const styleTag = document.createElement('style');
  styleTag.textContent = css;
  document.head.appendChild(styleTag);

  function makeButton(label, href) {
    const btn = document.createElement('a');
    btn.href = href;
    btn.target = '_blank';
    btn.rel = 'noopener noreferrer';
    btn.textContent = label;
    btn.className = active.buttonClass;
    if (active.hover) active.hover(btn);
    return btn;
  }

  function makeLibbyButton(title) {
    const btn = document.createElement('a');
    btn.href = '#';
    btn.textContent = 'Libby';
    btn.className = active.buttonClass;
    if (active.hover) active.hover(btn);

    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        await navigator.clipboard.writeText(title);
      } catch (err) {
        alert('Copy to clipboard failed.');
      }
      window.open('https://libbyapp.com/search', '_blank', 'noopener');
    });

    return btn;
  }

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

  async function init() {
    if (!detectSite()) return;
    
    // Check if buttons already exist to prevent duplicates on navigation
    if (document.getElementById('book-more-links')) return;

    const { title, isbn } = active.extractData ? active.extractData() : extractBookData();
    if (!title) return;

    const effectiveUrl = await getEffectiveUrl();
    const links = buildSearchUrls(effectiveUrl, title, isbn);

    const container = document.createElement('div');
    active.container(container);
    const wrapper = active.wrapper ? active.wrapper() : container;

    const addBtn = (el) => {
      const node = active.buttonWrapper ? active.buttonWrapper(el) : el;
      wrapper.appendChild(node);
    };

    if (links.annaIsbn) addBtn(makeButton('Anna (ISBN)', links.annaIsbn));
    addBtn(makeButton('Anna (Title)', links.annaTitle));
    addBtn(makeLibbyButton(title));

    if (wrapper !== container) container.appendChild(wrapper);

    const { parent, before } = active.insertTarget();
    if (parent) parent.insertBefore(container, before);

    if (active.responsive && active.selectors) {
      handleResponsiveMigration(container, active.selectors);
    }
  }

  /**
   * Handle SPA navigation (essential for StoryGraph)
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

  // Initial load
  init().catch(console.error);
  // Listen for SPA route changes
  handleRouting();

})();