(() => {
  const modal = document.querySelector('[data-hospitality-modal]');
  const panel = modal?.querySelector('.project-modal__panel');
  const trigger = document.querySelector('[data-hospitality-modal-open]');
  let lastTrigger = null;

  function openModal(source, event) {
    event?.preventDefault();
    if (!modal) return;
    lastTrigger = source || null;
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('has-about-modal', 'has-project-modal');
    requestAnimationFrame(() => {
      modal.querySelector('[data-hospitality-modal-close]')?.focus({ preventScroll: true });
    });
  }

  function closeModal({ restoreFocus = true } = {}) {
    if (!modal) return;
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('has-about-modal', 'has-project-modal');
    if (restoreFocus && lastTrigger instanceof HTMLElement) {
      lastTrigger.focus({ preventScroll: true });
    }
  }

  trigger?.addEventListener('click', (event) => openModal(trigger, event));
  modal?.querySelectorAll('[data-hospitality-modal-close]').forEach((button) => {
    button.addEventListener('click', () => closeModal());
  });
  panel?.addEventListener('click', (event) => event.stopPropagation());
  document.querySelector('[data-hospitality-modal-cta]')?.addEventListener('click', () => {
    closeModal({ restoreFocus: false });
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal?.classList.contains('is-open')) closeModal();
  });
})();
