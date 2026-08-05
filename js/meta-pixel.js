(() => {
  const PIXEL_ID = '27788103487524302';
  const CONSENT_STORAGE_KEY = 'casaGlickCookieConsent';
  let initialized = false;

  const hasMarketingConsent = () => {
    try {
      return localStorage.getItem(CONSENT_STORAGE_KEY) === 'accepted';
    } catch (_) {
      return document.documentElement.dataset.cookieConsent === 'accepted';
    }
  };

  const initializeMetaPixel = () => {
    if (initialized || !hasMarketingConsent()) return;
    initialized = true;

    !function(f,b,e,v,n,t,s) {
      if (f.fbq) return;
      n = f.fbq = function() {
        n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
      };
      if (!f._fbq) f._fbq = n;
      n.push = n;
      n.loaded = true;
      n.version = '2.0';
      n.queue = [];
      t = b.createElement(e);
      t.async = true;
      t.src = v;
      s = b.getElementsByTagName(e)[0];
      s.parentNode.insertBefore(t, s);
    }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');

    fbq('init', PIXEL_ID);
    fbq('track', 'PageView');
  };

  const sanitizeParameters = (parameters = {}) => {
    const clean = {};
    Object.entries(parameters || {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return;
      clean[key] = value;
    });
    return clean;
  };

  const trackOnce = (storageKey, eventName, parameters = {}) => {
    if (!storageKey) return;
    const key = `casaGlickMetaEvent:${storageKey}`;
    try {
      if (localStorage.getItem(key) === 'sent') return;
      initializeMetaPixel();
      if (initialized && typeof window.fbq === 'function') {
        window.fbq('track', eventName, sanitizeParameters(parameters));
        localStorage.setItem(key, 'sent');
      }
    } catch (_) {
      initializeMetaPixel();
      if (initialized && typeof window.fbq === 'function') {
        window.fbq('track', eventName, sanitizeParameters(parameters));
      }
    }
  };

  window.CasaGlickMetaPixel = {
    init: initializeMetaPixel,
    track(eventName, parameters = {}) {
      initializeMetaPixel();
      if (initialized && typeof window.fbq === 'function') {
        window.fbq('track', eventName, sanitizeParameters(parameters));
      }
    },
    trackOnce,
    trackCustom(eventName, parameters = {}) {
      initializeMetaPixel();
      if (initialized && typeof window.fbq === 'function') {
        window.fbq('trackCustom', eventName, sanitizeParameters(parameters));
      }
    }
  };


  const contactMethodFromHref = (href = '') => {
    const value = String(href).trim().toLowerCase();
    if (value.startsWith('mailto:')) return 'email';
    if (value.startsWith('tel:')) return 'phone';
    if (value.includes('wa.me/') || value.includes('whatsapp.com/')) return 'whatsapp';
    return '';
  };

  document.addEventListener('click', (event) => {
    const link = event.target?.closest?.('a[href]');
    if (!link) return;

    const href = String(link.getAttribute('href') || '');
    const absoluteHref = String(link.href || href);
    const contactMethod = contactMethodFromHref(absoluteHref);

    if (contactMethod) {
      window.CasaGlickMetaPixel?.track?.('Contact', {
        content_name: String(link.getAttribute('aria-label') || link.textContent || 'Contacto').trim(),
        contact_method: contactMethod
      });
      return;
    }

    if (/google\.[^/]+\/maps|maps\.google\.|google\.com\/maps/i.test(absoluteHref)) {
      window.CasaGlickMetaPixel?.track?.('FindLocation', {
        content_name: 'Showroom Casa Glick',
        location: 'Temístocles 51, Polanco, CDMX'
      });
    }
  });

  window.addEventListener('casa-glick:cookie-consent', (event) => {
    if (event.detail?.status === 'accepted') initializeMetaPixel();
  });

  initializeMetaPixel();
})();
