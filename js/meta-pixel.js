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

  window.CasaGlickMetaPixel = {
    init: initializeMetaPixel,
    track(eventName, parameters = {}) {
      initializeMetaPixel();
      if (initialized && typeof window.fbq === 'function') {
        window.fbq('track', eventName, parameters);
      }
    },
    trackCustom(eventName, parameters = {}) {
      initializeMetaPixel();
      if (initialized && typeof window.fbq === 'function') {
        window.fbq('trackCustom', eventName, parameters);
      }
    }
  };

  window.addEventListener('casa-glick:cookie-consent', (event) => {
    if (event.detail?.status === 'accepted') initializeMetaPixel();
  });

  initializeMetaPixel();
})();
