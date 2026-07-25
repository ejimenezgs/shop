(() => {
  const aboutModal = document.querySelector('[data-about-modal]');
  const aboutModalPanel = aboutModal?.querySelector('.project-modal__panel');
  const aboutModalOpen = document.querySelector('[data-about-modal-open]');
  let lastAboutTrigger = null;

  function openAboutModal(trigger, event) {
    event?.preventDefault();
    if (!aboutModal) return;
    lastAboutTrigger = trigger || null;
    aboutModal.classList.add('is-open');
    aboutModal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('has-about-modal', 'has-project-modal');
    requestAnimationFrame(() => {
      aboutModal.querySelector('[data-about-modal-close]')?.focus({ preventScroll: true });
    });
  }

  function closeAboutModal({ restoreFocus = true } = {}) {
    if (!aboutModal) return;
    aboutModal.classList.remove('is-open');
    aboutModal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('has-about-modal', 'has-project-modal');
    if (restoreFocus && lastAboutTrigger instanceof HTMLElement) {
      lastAboutTrigger.focus({ preventScroll: true });
    }
  }

  aboutModalOpen?.addEventListener('click', (event) => openAboutModal(aboutModalOpen, event));

  aboutModal?.querySelectorAll('[data-about-modal-close]').forEach((button) => {
    button.addEventListener('click', () => closeAboutModal());
  });

  aboutModalPanel?.addEventListener('click', (event) => {
    event.stopPropagation();
  });

  document.querySelector('[data-about-modal-cta]')?.addEventListener('click', () => {
    closeAboutModal({ restoreFocus: false });
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && aboutModal?.classList.contains('is-open')) {
      closeAboutModal();
    }
  });
})();
