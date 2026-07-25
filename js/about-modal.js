(() => {
  const modal = document.querySelector('#about-modal');
  const trigger = document.querySelector('[data-about-modal-trigger]');
  if (!modal || !trigger) return;

  const panel = modal.querySelector('.about-modal__panel');
  const closeControls = modal.querySelectorAll('[data-about-modal-close]');
  const contactLink = modal.querySelector('[data-about-modal-contact]');
  let lastFocused = null;

  const getFocusable = () => Array.from(modal.querySelectorAll(
    'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )).filter((element) => !element.hidden);

  const openModal = (event) => {
    if (event) event.preventDefault();
    lastFocused = document.activeElement;
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('has-about-modal');
    requestAnimationFrame(() => {
      modal.classList.add('is-open');
      panel?.focus({ preventScroll: true });
    });
  };

  const closeModal = ({ restoreFocus = true } = {}) => {
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('has-about-modal');
    window.setTimeout(() => {
      modal.hidden = true;
      if (restoreFocus && lastFocused instanceof HTMLElement) lastFocused.focus();
    }, 420);
  };

  trigger.addEventListener('click', openModal);
  closeControls.forEach((control) => control.addEventListener('click', () => closeModal()));
  contactLink?.addEventListener('click', () => closeModal({ restoreFocus: false }));

  document.addEventListener('keydown', (event) => {
    if (modal.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeModal();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = getFocusable();
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
})();
