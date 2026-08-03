(() => {
  const STORAGE_KEY = 'casaGlickCookieConsent';
  const banner = document.querySelector('[data-cookie-banner]');
  if (!banner) return;

  const acceptButton = banner.querySelector('[data-cookie-accept]');

  const getStoredConsent = () => {
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      return value === 'accepted' || value === 'necessary' ? value : null;
    } catch (_) {
      return null;
    }
  };

  const saveConsent = () => {
    try {
      localStorage.setItem(STORAGE_KEY, 'accepted');
    } catch (_) {
      // The site remains usable when storage is unavailable.
    }
    document.documentElement.dataset.cookieConsent = 'accepted';
    window.dispatchEvent(new CustomEvent('casa-glick:cookie-consent', { detail: { status: 'accepted' } }));
    banner.classList.remove('is-visible');
    banner.setAttribute('aria-hidden', 'true');
  };

  const storedConsent = getStoredConsent();
  if (storedConsent) {
    document.documentElement.dataset.cookieConsent = storedConsent;
    banner.setAttribute('aria-hidden', 'true');
    return;
  }

  requestAnimationFrame(() => {
    banner.classList.add('is-visible');
    banner.setAttribute('aria-hidden', 'false');
  });

  acceptButton?.addEventListener('click', saveConsent);
})();
