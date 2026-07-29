const hero = document.querySelector('.hero');
const heroButton = document.querySelector('.hero__button');
const menuToggle = document.querySelector('.menu-toggle');
const siteMenu = document.querySelector('#site-menu');
const menuLinks = document.querySelectorAll('.site-menu a');
const menuCloseButtons = document.querySelectorAll('.site-menu__close');
const scrollSections = document.querySelectorAll('.scroll-section');

let heroIntroLocked = true;
let ticking = false;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const easeOutCubic = (value) => 1 - Math.pow(1 - value, 3);
const easeInOutCubic = (value) => value < 0.5
  ? 4 * value * value * value
  : 1 - Math.pow(-2 * value + 2, 3) / 2;

const updateNavbarState = () => {
  const isScrolled = (window.scrollY || document.documentElement.scrollTop || 0) > 18;
  document.body.classList.toggle('is-scrolled', isScrolled);
};

const getMotionTargets = (section) => {
  if (section.classList.contains('hero')) {
    return [
      section.querySelector('.hero__background'),
      section.querySelector('.hero__content'),
    ].filter(Boolean);
  }

  const target = section.querySelector('.section-motion-content');
  return target ? [target] : [section];
};

const applyMotion = (target, opacity, y) => {
  const cleanOpacity = clamp(opacity, 0, 1);
  target.style.setProperty('opacity', cleanOpacity.toFixed(3), 'important');
  target.style.setProperty('transform', `translate3d(0, ${y.toFixed(1)}px, 0)`, 'important');
  target.style.setProperty('pointer-events', cleanOpacity > 0.14 ? 'auto' : 'none', 'important');
};

const updateSectionMotion = () => {
  const vh = window.innerHeight || document.documentElement.clientHeight;

  scrollSections.forEach((section) => {
    if (section.classList.contains('hero') && heroIntroLocked && window.scrollY < 12) return;

    const rect = section.getBoundingClientRect();
    let opacity = 1;
    let y = 0;

    if (rect.top >= vh) {
      opacity = 0;
      y = 76;
    } else if (rect.top > 0) {
      const enterStart = vh * 0.95;
      const enterEnd = vh * 0.20;
      const progress = clamp((enterStart - rect.top) / (enterStart - enterEnd), 0, 1);
      const eased = easeOutCubic(progress);
      opacity = eased;
      y = 76 * (1 - eased);
    } else if (rect.bottom > 0) {
      // Contacto es la última sección antes del footer: al seguir bajando debe
      // permanecer visible hasta salir físicamente del viewport. Al volver hacia
      // arriba, la rama de entrada (rect.top > 0) conserva el desvanecimiento.
      const isContact = section.classList.contains('contact-section');
      if (isContact) {
        opacity = 1;
        y = 0;
        getMotionTargets(section).forEach((target) => applyMotion(target, opacity, y));
        return;
      }

      // Salida progresiva. El hero debe irse antes para que no se vea dentro del bloque de Productos.
      const passed = -rect.top;
      const isHero = section.classList.contains('hero');
      const isLifestyle = section.classList.contains('lifestyle');

      // En móvil, la sección de inspiración no debe ocultarse antes de tiempo.
      // Se empieza a desvanecer solo cuando el bloque Showroom realmente entra al viewport.
      if (isLifestyle && window.innerWidth <= 760) {
        const showroomSection = document.querySelector('.showroom');
        if (showroomSection) {
          const showroomRect = showroomSection.getBoundingClientRect();
          const enterStart = vh * 0.95;
          const enterEnd = vh * 0.22;
          const progress = clamp((enterStart - showroomRect.top) / (enterStart - enterEnd), 0, 1);
          const eased = easeInOutCubic(progress);
          opacity = 1 - eased;
          y = -48 * eased;
        } else {
          const exitStart = vh * 0.92;
          const exitEnd = vh * 1.25;
          const progress = clamp((passed - exitStart) / (exitEnd - exitStart), 0, 1);
          const eased = easeInOutCubic(progress);
          opacity = 1 - eased;
          y = -48 * eased;
        }
      } else {
        const exitStart = vh * (isHero ? 0.08 : (isLifestyle ? 0.68 : 0.34));
        const exitEnd = vh * (isHero ? 0.58 : (isLifestyle ? 1.10 : 0.96));
        const progress = clamp((passed - exitStart) / (exitEnd - exitStart), 0, 1);
        const eased = easeInOutCubic(progress);
        opacity = 1 - eased;
        y = (isHero ? -190 : (isLifestyle ? -64 : -128)) * eased;
      }
    } else {
      opacity = 0;
      y = -128;
    }

    getMotionTargets(section).forEach((target) => applyMotion(target, opacity, y));
  });
};

const requestMotionUpdate = () => {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    updateNavbarState();
    updateSectionMotion();
    ticking = false;
  });
};

const closeMenu = () => {
  document.body.classList.remove('menu-open');
  if (menuToggle) menuToggle.setAttribute('aria-expanded', 'false');
  if (siteMenu) siteMenu.setAttribute('aria-hidden', 'true');
};

const openMenu = () => {
  document.body.classList.add('menu-open');
  if (menuToggle) menuToggle.setAttribute('aria-expanded', 'true');
  if (siteMenu) siteMenu.setAttribute('aria-hidden', 'false');
};

if (menuToggle) {
  menuToggle.addEventListener('click', () => {
    document.body.classList.contains('menu-open') ? closeMenu() : openMenu();
  });
}

menuLinks.forEach((link) => link.addEventListener('click', closeMenu));
menuCloseButtons.forEach((button) => button.addEventListener('click', closeMenu));
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeMenu();
});

if (heroButton) {
  heroButton.addEventListener('click', (event) => {
    const target = document.querySelector(heroButton.getAttribute('href'));
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

window.addEventListener('load', () => {
  if (hero) hero.classList.add('is-visible');
  updateNavbarState();
  updateSectionMotion();
  window.setTimeout(() => {
    heroIntroLocked = false;
    updateSectionMotion();
  }, 2100);
});

window.addEventListener('scroll', requestMotionUpdate, { passive: true });
window.addEventListener('resize', requestMotionUpdate);
updateNavbarState();
requestAnimationFrame(updateSectionMotion);

// Lifestyle carousel: Womo-style infinite loop, cursor steering, direct drag and image lightbox
(() => {
  const pageTracks = document.querySelectorAll('.lifestyle__track');
  if (!pageTracks.length) return;

  const lightbox = (() => {
    const overlay = document.createElement('div');
    overlay.className = 'lifestyle-lightbox';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = `
      <div class="lifestyle-lightbox__backdrop" data-lifestyle-lightbox-close></div>
      <figure class="lifestyle-lightbox__panel" role="dialog" aria-modal="true" aria-label="Vista ampliada de imagen lifestyle">
        <button class="lifestyle-lightbox__close" type="button" aria-label="Cerrar imagen" data-lifestyle-lightbox-close>×</button>
        <img class="lifestyle-lightbox__image" alt="" />
      </figure>
    `;
    document.body.appendChild(overlay);

    const image = overlay.querySelector('.lifestyle-lightbox__image');
    let lastTrigger = null;

    const close = ({ restoreFocus = true } = {}) => {
      overlay.classList.remove('is-open');
      overlay.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('has-lifestyle-lightbox');
      if (restoreFocus && lastTrigger instanceof HTMLElement) lastTrigger.focus({ preventScroll: true });
    };

    const open = (src, alt, trigger) => {
      if (!src) return;
      lastTrigger = trigger || null;
      image.src = src;
      image.alt = alt || 'Imagen lifestyle Casa Glick';
      overlay.classList.add('is-open');
      overlay.setAttribute('aria-hidden', 'false');
      document.body.classList.add('has-lifestyle-lightbox');
      requestAnimationFrame(() => overlay.querySelector('.lifestyle-lightbox__close')?.focus({ preventScroll: true }));
    };

    overlay.querySelectorAll('[data-lifestyle-lightbox-close]').forEach((button) => button.addEventListener('click', () => close()));
    overlay.querySelector('.lifestyle-lightbox__panel')?.addEventListener('click', (event) => event.stopPropagation());
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && overlay.classList.contains('is-open')) close();
    });

    return { open };
  })();

  pageTracks.forEach((track) => {
    const carousel = track.closest('.lifestyle__carousel');
    if (!carousel) return;

    const sourceItems = Array.from(track.querySelectorAll('.lifestyle-item')).map((item) => item.cloneNode(true));
    if (!sourceItems.length) return;

    const mobileQuery = window.matchMedia('(max-width: 700px)');
    let currentMode = '';
    let loopWidth = 0;
    let pointerDown = false;
    let pointerId = null;
    let dragStartX = 0;
    let dragStartScroll = 0;
    let movedDuringPointer = false;
    let pointerStartItem = null;
    let blockClickUntil = 0;
    let cursorVelocity = 0;
    let animationFrame = 0;
    let lastFrameTime = 0;

    const isDesktop = () => !mobileQuery.matches;

    const makeGroups = (groupSize, cloneClass = '') => {
      const fragment = document.createDocumentFragment();
      for (let index = 0; index < sourceItems.length; index += groupSize) {
        const group = document.createElement('div');
        group.className = `lifestyle-group${cloneClass ? ` ${cloneClass}` : ''}`;
        sourceItems.slice(index, index + groupSize).forEach((item) => {
          const clone = item.cloneNode(true);
          if (cloneClass) clone.setAttribute('aria-hidden', 'true');
          group.appendChild(clone);
        });
        fragment.appendChild(group);
      }
      return fragment;
    };

    const measureLoop = () => {
      const groups = Array.from(track.children);
      const setCount = groups.length / 3;
      const first = groups[setCount];
      const after = groups[setCount * 2];
      loopWidth = first && after ? after.offsetLeft - first.offsetLeft : track.scrollWidth / 3;
    };

    const normalizeLoop = () => {
      if (loopWidth <= 1) return;
      if (carousel.scrollLeft >= loopWidth * 2) carousel.scrollLeft -= loopWidth;
      else if (carousel.scrollLeft < loopWidth * 0.25) carousel.scrollLeft += loopWidth;
    };

    const build = () => {
      const mode = isDesktop() ? 'desktop' : 'mobile';
      if (mode === currentMode && track.children.length) return;
      currentMode = mode;
      stopMotion();

      const groupSize = mode === 'desktop' ? 3 : 2;
      const fragment = document.createDocumentFragment();
      fragment.appendChild(makeGroups(groupSize, 'is-loop-clone'));
      fragment.appendChild(makeGroups(groupSize));
      fragment.appendChild(makeGroups(groupSize, 'is-loop-clone'));
      track.replaceChildren(fragment);
      requestAnimationFrame(() => {
        measureLoop();
        carousel.scrollLeft = loopWidth;
      });
    };

    function stopMotion() {
      cursorVelocity = 0;
      lastFrameTime = 0;
      if (animationFrame) cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    }

    const motionTick = (time) => {
      if (!isDesktop() || pointerDown || Math.abs(cursorVelocity) < 0.01) {
        animationFrame = 0;
        return;
      }
      if (!lastFrameTime) lastFrameTime = time;
      const delta = Math.min(32, time - lastFrameTime);
      lastFrameTime = time;
      carousel.scrollLeft += cursorVelocity * delta;
      normalizeLoop();
      animationFrame = requestAnimationFrame(motionTick);
    };

    const updateCursorVelocity = (clientX) => {
      if (!isDesktop() || pointerDown) return;
      const rect = carousel.getBoundingClientRect();
      const normalized = ((clientX - rect.left) / rect.width) * 2 - 1;
      const deadZone = 0.12;
      if (Math.abs(normalized) <= deadZone) {
        stopMotion();
        return;
      }
      const strength = (Math.abs(normalized) - deadZone) / (1 - deadZone);
      cursorVelocity = Math.sign(normalized) * (0.112 + strength * 0.434);
      if (!animationFrame) animationFrame = requestAnimationFrame(motionTick);
    };

    carousel.addEventListener('pointerenter', (event) => updateCursorVelocity(event.clientX));
    carousel.addEventListener('pointermove', (event) => {
      if (pointerDown && event.pointerId === pointerId) {
        const deltaX = event.clientX - dragStartX;
        if (Math.abs(deltaX) > 5) movedDuringPointer = true;
        carousel.scrollLeft = dragStartScroll - deltaX * 1.12;
        normalizeLoop();
        event.preventDefault();
        return;
      }
      updateCursorVelocity(event.clientX);
    });
    carousel.addEventListener('pointerleave', () => {
      if (!pointerDown) stopMotion();
    });

    carousel.addEventListener('pointerdown', (event) => {
      if (!isDesktop() || event.pointerType === 'touch' || event.button !== 0) return;
      pointerDown = true;
      pointerId = event.pointerId;
      dragStartX = event.clientX;
      dragStartScroll = carousel.scrollLeft;
      movedDuringPointer = false;
      pointerStartItem = event.target.closest('.lifestyle-item');
      carousel.classList.add('is-dragging');
      stopMotion();
      try { carousel.setPointerCapture(pointerId); } catch (error) {}
      event.preventDefault();
    });

    const endPointer = (event) => {
      if (!pointerDown || (event && pointerId !== null && event.pointerId !== pointerId)) return;
      const shouldOpen = !movedDuringPointer && pointerStartItem;
      const itemToOpen = pointerStartItem;
      pointerDown = false;
      pointerId = null;
      pointerStartItem = null;
      carousel.classList.remove('is-dragging');
      normalizeLoop();
      blockClickUntil = performance.now() + 240;
      if (shouldOpen) {
        const image = itemToOpen.querySelector('img');
        if (image) lightbox.open(image.currentSrc || image.src, image.alt, itemToOpen);
      }
    };

    carousel.addEventListener('pointerup', endPointer);
    carousel.addEventListener('pointercancel', endPointer);
    carousel.addEventListener('lostpointercapture', endPointer);
    carousel.addEventListener('dragstart', (event) => event.preventDefault());
    carousel.addEventListener('scroll', normalizeLoop, { passive: true });
    carousel.addEventListener('touchend', () => window.setTimeout(normalizeLoop, 80), { passive: true });

    carousel.addEventListener('wheel', (event) => {
      if (!isDesktop()) return;
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      carousel.scrollLeft += delta;
      normalizeLoop();
      event.preventDefault();
    }, { passive: false });

    carousel.addEventListener('click', (event) => {
      if (performance.now() < blockClickUntil || isDesktop()) {
        event.preventDefault();
        return;
      }
      const item = event.target.closest('.lifestyle-item');
      const image = item?.querySelector('img');
      if (image) lightbox.open(image.currentSrc || image.src, image.alt, item);
    });

    let resizeTimer = 0;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        currentMode = '';
        build();
      }, 120);
    });

    build();
  });
})();


// Products listing page filters
const productFilterButtons = document.querySelectorAll('.products-filter__item');
const productCategoryPicker = document.querySelector('.products-picker__select');
const productCards = document.querySelectorAll('.product-card');
const normalizeFilter = (value) => {
  const clean = (value || 'todo').toLowerCase().trim();
  if (clean === 'all') return 'todo';
  if (clean === 'sofas' || clean === 'sofás') return 'sofas';
  if (clean === 'decoración') return 'decoracion';
  if (clean === 'iluminación') return 'iluminacion';
  return clean;
};

const applyProductFilter = (filter, updateUrl = true) => {
  if (!productFilterButtons.length || !productCards.length) return;
  const activeFilter = normalizeFilter(filter);

  productFilterButtons.forEach((button) => {
    button.classList.toggle('is-active', button.dataset.filter === activeFilter);
  });

  if (productCategoryPicker && productCategoryPicker.value !== activeFilter) {
    productCategoryPicker.value = activeFilter;
  }

  productCards.forEach((card) => {
    const show = activeFilter === 'todo' || card.dataset.category === activeFilter;
    card.classList.toggle('is-hidden', !show);
  });

  if (updateUrl) {
    const url = new URL(window.location.href);
    url.searchParams.set('filter', activeFilter);
    window.history.replaceState({}, '', url);
  }
};

if (productFilterButtons.length && productCards.length) {
  const params = new URLSearchParams(window.location.search);
  const initialFilter = normalizeFilter(params.get('filter') || params.get('category') || 'todo');
  applyProductFilter(initialFilter, false);

  productFilterButtons.forEach((button) => {
    button.addEventListener('click', () => applyProductFilter(button.dataset.filter));
  });

  if (productCategoryPicker) {
    productCategoryPicker.addEventListener('change', () => applyProductFilter(productCategoryPicker.value));
  }
}

// Product detail content is loaded exclusively from catalog-public.js.

const productSwatches = document.querySelectorAll('.product-swatch');
productSwatches.forEach((swatch) => {
  swatch.addEventListener('click', () => {
    productSwatches.forEach((item) => item.classList.remove('is-active'));
    swatch.classList.add('is-active');
  });
});

// Mobile product detail bottom sheet
const mobileProductSheet = document.querySelector('[data-mobile-product-sheet]');
if (mobileProductSheet) {
  const isProductMobile = () => window.matchMedia('(max-width: 820px)').matches;
  const isProductLightboxOpen = () => document.body.classList.contains('has-product-lightbox');
  const mobileTabs = mobileProductSheet.querySelectorAll('.product-mobile-tab');
  const sheetToggle = mobileProductSheet.querySelector('[data-product-sheet-toggle]');
  let lastScrollY = window.scrollY || 0;
  let touchStartY = 0;
  let ignoreUntil = 0;
  let currentSheetState = 'peek';
  let lastSheetHideAt = 0;
  let touchLastY = 0;
  let touchAccumulatedDelta = 0;
  let suppressScrollPeekUntil = 0;
  let lastTouchScrollIntent = '';
  let lastTouchScrollIntentAt = 0;

  // v17: on mobile the sheet must be a direct child of body.
  // This prevents fixed positioning from being trapped at the bottom of the gallery/layout flow.
  const originalSheetParent = mobileProductSheet.parentNode;
  const originalSheetNext = mobileProductSheet.nextSibling;
  const sheetPlaceholder = document.createComment('mobile product sheet placeholder');
  originalSheetParent.insertBefore(sheetPlaceholder, mobileProductSheet);

  const syncSheetMount = () => {
    if (isProductMobile()) {
      if (mobileProductSheet.parentNode !== document.body) {
        document.body.appendChild(mobileProductSheet);
      }
    } else if (mobileProductSheet.parentNode === document.body) {
      if (originalSheetNext && originalSheetNext.parentNode === originalSheetParent) {
        originalSheetParent.insertBefore(mobileProductSheet, originalSheetNext);
      } else {
        originalSheetParent.insertBefore(mobileProductSheet, sheetPlaceholder.nextSibling);
      }
    }
  };

  const setSheetState = (state) => {
    currentSheetState = state === 'expanded' ? 'expanded' : state === 'hidden' ? 'hidden' : 'peek';
    if (currentSheetState === 'hidden') lastSheetHideAt = Date.now();
    syncSheetMount();
    if (!isProductMobile()) {
      mobileProductSheet.classList.remove('is-peeking', 'is-expanded', 'is-hidden-mobile-sheet');
      return;
    }

    mobileProductSheet.classList.remove('is-peeking', 'is-expanded', 'is-hidden-mobile-sheet');

    if (state === 'expanded') {
      mobileProductSheet.classList.add('is-peeking', 'is-expanded');
      if (sheetToggle) sheetToggle.setAttribute('aria-label', 'Minimizar información del producto');
      return;
    }

    if (state === 'hidden') {
      mobileProductSheet.classList.add('is-hidden-mobile-sheet');
      if (sheetToggle) sheetToggle.setAttribute('aria-label', 'Expandir información del producto');
      return;
    }

    mobileProductSheet.classList.add('is-peeking');
    if (sheetToggle) sheetToggle.setAttribute('aria-label', 'Expandir información del producto');
  };

  mobileProductSheet.dataset.activeTab = mobileProductSheet.dataset.activeTab || 'description';

  if (sheetToggle) {
    sheetToggle.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!isProductMobile()) return;
      if (mobileProductSheet.classList.contains('is-expanded')) {
        setSheetState('peek');
      } else {
        setSheetState('expanded');
      }
      ignoreUntil = Date.now() + 520;
    });
  }

  mobileTabs.forEach((tab) => {
    tab.addEventListener('click', (event) => {
      event.stopPropagation();
      mobileTabs.forEach((item) => item.classList.remove('is-active'));
      tab.classList.add('is-active');
      mobileProductSheet.dataset.activeTab = tab.dataset.productTab || 'description';
      setSheetState('peek');
      ignoreUntil = Date.now() + 380;
    });
  });

  const canMoveSheet = () => (
    isProductMobile()
    && !isProductLightboxOpen()
    && Date.now() >= ignoreUntil
    && !mobileProductSheet.classList.contains('is-expanded')
    && !document.body.classList.contains('menu-open')
  );

  const requestSheetForScrollDirection = (direction, force = false) => {
    if (!canMoveSheet()) return;

    if (direction === 'down') {
      if (currentSheetState !== 'hidden' || force) {
        setSheetState('hidden');
      }
      return;
    }

    if (direction === 'up') {
      // Show again only after a real upward gesture, not from the small layout bounce
      // created right after the sheet hides.
      if (!force && Date.now() < suppressScrollPeekUntil) return;
      if (currentSheetState !== 'peek' || force) {
        setSheetState('peek');
      }
    }
  };

  const resetScrollIntent = () => {
    touchStartY = 0;
    touchLastY = 0;
    touchAccumulatedDelta = 0;
  };

  const hasRecentTouchIntent = (intent) => (
    lastTouchScrollIntent === intent
    && Date.now() - lastTouchScrollIntentAt < 520
  );

  let scrollDownIntent = 0;
  let scrollUpIntent = 0;
  let sheetStateLockedUntil = 0;

  window.addEventListener('touchstart', (event) => {
    if (!isProductMobile() || isProductLightboxOpen()) return;
    touchStartY = event.touches[0]?.clientY || 0;
    touchLastY = touchStartY;
    touchAccumulatedDelta = 0;
  }, { passive: true });

  window.addEventListener('touchmove', (event) => {
    if (!isProductMobile() || isProductLightboxOpen()) return;
    const currentY = event.touches[0]?.clientY || 0;
    if (!touchLastY) {
      touchLastY = currentY;
      return;
    }

    const fingerDelta = currentY - touchLastY;
    touchLastY = currentY;

    if (Math.abs(fingerDelta) < 3) return;

    // Finger moves up = page goes down. Finger moves down = page goes up.
    lastTouchScrollIntent = fingerDelta < 0 ? 'down' : 'up';
    lastTouchScrollIntentAt = Date.now();
  }, { passive: true });

  window.addEventListener('touchend', resetScrollIntent, { passive: true });
  window.addEventListener('touchcancel', resetScrollIntent, { passive: true });

  window.addEventListener('scroll', () => {
    const current = Math.max(0, window.scrollY || 0);

    if (!canMoveSheet()) {
      lastScrollY = current;
      scrollDownIntent = 0;
      scrollUpIntent = 0;
      return;
    }

    const diff = current - lastScrollY;
    lastScrollY = current;

    if (Math.abs(diff) < 1.5) return;

    if (diff > 0) {
      scrollDownIntent += diff;
      scrollUpIntent = 0;

      if (scrollDownIntent >= 8 && currentSheetState !== 'hidden') {
        setSheetState('hidden');
        sheetStateLockedUntil = Date.now() + 360;
        scrollDownIntent = 0;
      }
      return;
    }

    if (diff < 0) {
      scrollUpIntent += Math.abs(diff);
      scrollDownIntent = 0;

      if (
        currentSheetState === 'hidden'
        && scrollUpIntent >= 18
        && Date.now() >= sheetStateLockedUntil
        && hasRecentTouchIntent('up')
      ) {
        setSheetState('peek');
        scrollUpIntent = 0;
      }
    }
  }, { passive: true });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setSheetState('peek');
  });

  const showInitialMobileSheet = () => {
    if (isProductMobile()) {
      setSheetState('peek');
      lastScrollY = window.scrollY || 0;
    } else {
      setSheetState('hidden');
    }
  };

  window.addEventListener('resize', () => {
    syncSheetMount();
    showInitialMobileSheet();
  });
  syncSheetMount();
  showInitialMobileSheet();

  // Force the intended initial mobile state after layout and images settle.
  window.setTimeout(() => {
    syncSheetMount();
    if (isProductMobile()) setSheetState('peek');
  }, 60);
  window.requestAnimationFrame(showInitialMobileSheet);
  window.addEventListener('load', showInitialMobileSheet, { once: true });
}

// v27: smooth page transitions between landing, products and product detail pages
(() => {
  const transitionLinks = document.querySelectorAll('a[href^="productos.html"], a[href^="producto.html"]');
  transitionLinks.forEach((link) => {
    link.addEventListener('click', (event) => {
      const href = link.getAttribute('href');
      if (!href || link.target || href.startsWith('#') || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      document.body.classList.add('is-page-leaving');
      window.setTimeout(() => {
        window.location.href = href;
      }, 360);
    });
  });
})();

// v67: product gallery lightbox with dynamic API image count
(() => {
  const gallery = document.querySelector('.product-gallery');
  if (!gallery) return;

  const lightbox = document.createElement('div');
  lightbox.className = 'product-image-lightbox';
  lightbox.setAttribute('role', 'dialog');
  lightbox.setAttribute('aria-modal', 'true');
  lightbox.setAttribute('aria-label', 'Imagen ampliada del producto');
  lightbox.innerHTML = `
    <button class="product-image-lightbox__nav product-image-lightbox__nav--prev" type="button" aria-label="Imagen anterior">
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M15 5 L8 12 L15 19" /></svg>
    </button>
    <img class="product-image-lightbox__image" alt="Imagen ampliada del producto" />
    <button class="product-image-lightbox__nav product-image-lightbox__nav--next" type="button" aria-label="Siguiente imagen">
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9 5 L16 12 L9 19" /></svg>
    </button>
  `;
  document.body.appendChild(lightbox);

  const lightboxImage = lightbox.querySelector('.product-image-lightbox__image');
  const prevButton = lightbox.querySelector('.product-image-lightbox__nav--prev');
  const nextButton = lightbox.querySelector('.product-image-lightbox__nav--next');
  let activeIndex = 0;
  let lastFocusedImage = null;
  let touchStartX = 0;
  let lastImageTapAt = 0;

  const getImages = () => Array.from(gallery.querySelectorAll('[data-product-image]'));

  const prepareImages = () => {
    getImages().forEach((image) => {
      image.setAttribute('tabindex', '0');
      image.setAttribute('role', 'button');
      image.setAttribute('aria-label', `${image.alt || 'Imagen de producto'} ampliada`);
    });
  };

  const setLightboxZoom = (isZoomed) => {
    lightbox.classList.toggle('is-zoomed', Boolean(isZoomed));
    lightboxImage?.setAttribute('aria-label', isZoomed ? 'Doble click para reducir imagen' : 'Doble click para ampliar imagen');
  };

  const setLightboxImage = (index) => {
    const images = getImages();
    if (!images.length || !lightboxImage) return;
    activeIndex = (index + images.length) % images.length;
    const image = images[activeIndex];
    setLightboxZoom(false);
    lightboxImage.classList.remove('is-loaded');
    window.setTimeout(() => {
      lightboxImage.src = image.currentSrc || image.src;
      lightboxImage.alt = image.alt || 'Imagen ampliada del producto';
      lightboxImage.classList.add('is-loaded');
    }, 90);
    const showNav = images.length > 1;
    if (prevButton) prevButton.hidden = !showNav;
    if (nextButton) nextButton.hidden = !showNav;
  };

  const openLightbox = (image) => {
    const images = getImages();
    if (!image || !images.length) return;
    lastFocusedImage = image;
    setLightboxImage(Math.max(0, images.indexOf(image)));
    document.body.classList.add('has-product-lightbox');
    lightbox.classList.add('is-open');
  };

  const closeLightbox = () => {
    lightbox.classList.remove('is-open');
    setLightboxZoom(false);
    document.body.classList.remove('has-product-lightbox');
    window.setTimeout(() => {
      if (!lightbox.classList.contains('is-open') && lightboxImage) {
        lightboxImage.removeAttribute('src');
        lightboxImage.classList.remove('is-loaded');
      }
      lastFocusedImage?.focus?.();
    }, 560);
  };

  gallery.addEventListener('click', (event) => {
    const image = event.target.closest('[data-product-image]');
    if (image) openLightbox(image);
  });

  gallery.addEventListener('keydown', (event) => {
    const image = event.target.closest('[data-product-image]');
    if (!image || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    openLightbox(image);
  });

  prevButton?.addEventListener('click', (event) => {
    event.stopPropagation();
    setLightboxImage(activeIndex - 1);
  });

  nextButton?.addEventListener('click', (event) => {
    event.stopPropagation();
    setLightboxImage(activeIndex + 1);
  });

  lightboxImage?.addEventListener('click', (event) => event.stopPropagation());
  lightboxImage?.addEventListener('dblclick', (event) => {
    event.preventDefault();
    event.stopPropagation();
    setLightboxZoom(!lightbox.classList.contains('is-zoomed'));
  });

  lightbox.addEventListener('click', (event) => {
    if (event.target === lightbox) closeLightbox();
  });

  lightbox.addEventListener('touchstart', (event) => {
    touchStartX = event.touches[0]?.clientX || 0;
  }, { passive: true });

  lightbox.addEventListener('touchmove', (event) => event.stopPropagation(), { passive: true });

  lightbox.addEventListener('touchend', (event) => {
    const endX = event.changedTouches[0]?.clientX || touchStartX;
    const deltaX = touchStartX - endX;
    const images = getImages();
    if (images.length > 1 && Math.abs(deltaX) > 45) {
      setLightboxImage(activeIndex + (deltaX > 0 ? 1 : -1));
      return;
    }
    if (event.target === lightboxImage) {
      const now = Date.now();
      if (now - lastImageTapAt < 320) {
        setLightboxZoom(!lightbox.classList.contains('is-zoomed'));
        lastImageTapAt = 0;
      } else {
        lastImageTapAt = now;
      }
    }
  }, { passive: true });

  window.addEventListener('keydown', (event) => {
    if (!lightbox.classList.contains('is-open')) return;
    if (event.key === 'Escape') closeLightbox();
    if (event.key === 'ArrowLeft') setLightboxImage(activeIndex - 1);
    if (event.key === 'ArrowRight') setLightboxImage(activeIndex + 1);
  });

  document.addEventListener('casa-glick:gallery-updated', prepareImages);
  prepareImages();
})();

// v51: restore page state when returning with browser Back / bfcache
(() => {
  const resetPageTransition = () => {
    document.body.classList.remove('is-page-leaving');
    document.documentElement.classList.remove('is-page-leaving');
  };

  resetPageTransition();
  window.addEventListener('pageshow', resetPageTransition);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') resetPageTransition();
  });
})();


// v58: Showroom moving strip + image lightbox
(() => {
  const gallery = document.querySelector('.showroom__gallery');
  const track = gallery?.querySelector('.showroom__gallery-track');
  if (!gallery || !track) return;

  const originalItems = Array.from(track.querySelectorAll('.showroom__item'));
  if (!originalItems.length) return;

  originalItems.forEach((item) => {
    const clone = item.cloneNode(true);
    clone.classList.add('showroom__gallery-copy');
    clone.setAttribute('aria-hidden', 'true');
    track.appendChild(clone);
  });

  const measureDistance = () => {
    const first = originalItems[0];
    const last = originalItems[originalItems.length - 1];
    if (!first || !last) return;
    const styles = window.getComputedStyle(track);
    const gap = parseFloat(styles.columnGap || styles.gap || '0') || 0;
    const distance = (last.offsetLeft + last.offsetWidth - first.offsetLeft) + gap;
    track.style.setProperty('--showroom-track-distance', `${Math.max(distance, 1)}px`);
  };

  const scheduleMeasure = () => requestAnimationFrame(() => requestAnimationFrame(measureDistance));
  scheduleMeasure();
  window.addEventListener('load', scheduleMeasure);
  window.addEventListener('resize', scheduleMeasure);

  track.addEventListener('pointerenter', (event) => {
    if (event.target instanceof Element && event.target.closest('.showroom__item')) {
      track.classList.add('is-paused');
    }
  }, true);

  track.addEventListener('pointerleave', () => {
    track.classList.remove('is-paused');
  });

  const lightbox = document.createElement('div');
  lightbox.className = 'showroom-lightbox';
  lightbox.setAttribute('role', 'dialog');
  lightbox.setAttribute('aria-modal', 'true');
  lightbox.setAttribute('aria-label', 'Imagen ampliada del showroom');
  lightbox.innerHTML = `
    <button class="showroom-lightbox__close" type="button" aria-label="Cerrar imagen ampliada"></button>
    <img class="showroom-lightbox__image" alt="Imagen ampliada del showroom" />
  `;
  document.body.appendChild(lightbox);

  const lightboxImage = lightbox.querySelector('.showroom-lightbox__image');
  const closeButton = lightbox.querySelector('.showroom-lightbox__close');

  const openLightbox = (img) => {
    if (!img || !lightboxImage) return;
    track.classList.add('is-paused');
    document.body.classList.add('has-showroom-lightbox');
    lightboxImage.classList.remove('is-loaded');
    lightboxImage.src = img.currentSrc || img.src;
    lightboxImage.alt = img.alt || 'Imagen ampliada del showroom';
    requestAnimationFrame(() => {
      lightbox.classList.add('is-open');
      window.setTimeout(() => lightboxImage.classList.add('is-loaded'), 40);
    });
  };

  const closeLightbox = () => {
    lightbox.classList.remove('is-open');
    document.body.classList.remove('has-showroom-lightbox');
    track.classList.remove('is-paused');
    window.setTimeout(() => {
      if (!lightbox.classList.contains('is-open') && lightboxImage) {
        lightboxImage.removeAttribute('src');
        lightboxImage.classList.remove('is-loaded');
      }
    }, 360);
  };

  track.addEventListener('click', (event) => {
    const img = event.target instanceof Element ? event.target.closest('.showroom__item')?.querySelector('img') : null;
    if (img) openLightbox(img);
  });

  closeButton?.addEventListener('click', closeLightbox);
  lightbox.addEventListener('click', (event) => {
    if (event.target === lightbox) closeLightbox();
  });
  window.addEventListener('keydown', (event) => {
    if (!lightbox.classList.contains('is-open')) return;
    if (event.key === 'Escape') closeLightbox();
  });
})();


// v70: robust mobile picker filter fallback
(() => {
  const picker = document.querySelector('#products-category-picker');
  const cards = Array.from(document.querySelectorAll('.product-card'));
  const filterButtons = Array.from(document.querySelectorAll('.products-filter__item'));
  if (!picker || !cards.length) return;

  const normalize = (value) => {
    const clean = (value || 'todo').toLowerCase().trim();
    if (clean === 'all') return 'todo';
    if (clean === 'sofás') return 'sofas';
    if (clean === 'decoración') return 'decoracion';
    if (clean === 'iluminación') return 'iluminacion';
    if (clean === 'habitación') return 'habitacion';
    return clean;
  };

  const filterProducts = (value, updateUrl = true) => {
    const active = normalize(value);
    cards.forEach((card) => {
      const category = normalize(card.dataset.category);
      const show = active === 'todo' || category === active;
      card.classList.toggle('is-hidden', !show);
      card.hidden = !show;
    });
    filterButtons.forEach((button) => {
      button.classList.toggle('is-active', normalize(button.dataset.filter) === active);
    });
    if (picker.value !== active) picker.value = active;
    if (updateUrl) {
      const url = new URL(window.location.href);
      url.searchParams.set('filter', active);
      window.history.replaceState({}, '', url);
    }
  };

  picker.addEventListener('change', () => filterProducts(picker.value));
  picker.addEventListener('input', () => filterProducts(picker.value));

  filterButtons.forEach((button) => {
    button.addEventListener('click', () => filterProducts(button.dataset.filter));
  });

  const params = new URLSearchParams(window.location.search);
  filterProducts(params.get('filter') || params.get('category') || picker.value || 'todo', false);
})();


// v71: final robust product picker filter - runs after every previous layout override
(() => {
  const picker = document.getElementById('products-category-picker');
  const list = document.querySelector('.products-list');
  if (!picker || !list) return;

  const normalize = (value) => {
    const clean = String(value || 'todo').toLowerCase().trim();
    if (clean === 'all') return 'todo';
    if (clean === 'sofás') return 'sofas';
    if (clean === 'decoración') return 'decoracion';
    if (clean === 'iluminación') return 'iluminacion';
    if (clean === 'habitación') return 'habitacion';
    return clean;
  };

  const getCards = () => Array.from(list.querySelectorAll('.product-card'));

  const apply = (value, updateUrl = true) => {
    const active = normalize(value || picker.value || 'todo');
    getCards().forEach((card) => {
      const category = normalize(card.getAttribute('data-category'));
      const show = active === 'todo' || category === active;
      card.classList.toggle('is-hidden', !show);
      if (show) {
        card.removeAttribute('hidden');
        card.style.removeProperty('display');
      } else {
        card.setAttribute('hidden', '');
        card.style.setProperty('display', 'none', 'important');
      }
    });

    document.querySelectorAll('.products-filter__item').forEach((button) => {
      button.classList.toggle('is-active', normalize(button.dataset.filter) === active);
    });

    if (picker.value !== active) picker.value = active;

    if (updateUrl) {
      const url = new URL(window.location.href);
      url.searchParams.set('filter', active);
      window.history.replaceState({}, '', url);
    }
  };

  picker.onchange = () => apply(picker.value);
  picker.oninput = () => apply(picker.value);
  picker.addEventListener('change', () => requestAnimationFrame(() => apply(picker.value)), true);
  picker.addEventListener('input', () => requestAnimationFrame(() => apply(picker.value)), true);

  document.querySelectorAll('.products-filter__item').forEach((button) => {
    button.addEventListener('click', () => requestAnimationFrame(() => apply(button.dataset.filter)), true);
  });

  const params = new URLSearchParams(window.location.search);
  requestAnimationFrame(() => apply(params.get('filter') || params.get('category') || picker.value || 'todo', false));
})();


// v72: premium custom mobile products picker with robust filtering
(() => {
  const pickerWrap = document.querySelector('.products-picker');
  const control = document.querySelector('[data-products-custom-picker]');
  const select = document.getElementById('products-category-picker');
  const button = document.querySelector('.products-picker__button');
  const valueLabel = document.querySelector('.products-picker__value');
  const menu = document.querySelector('.products-picker__menu');
  const options = Array.from(document.querySelectorAll('.products-picker__option'));
  const list = document.querySelector('.products-list');
  if (!pickerWrap || !control || !select || !button || !valueLabel || !menu || !options.length || !list) return;

  const normalize = (value) => {
    const clean = String(value || 'todo').toLowerCase().trim();
    if (clean === 'all') return 'todo';
    if (clean === 'sofás') return 'sofas';
    if (clean === 'decoración') return 'decoracion';
    if (clean === 'iluminación') return 'iluminacion';
    if (clean === 'habitación') return 'habitacion';
    return clean;
  };

  const labelFor = (value) => {
    const option = options.find((item) => normalize(item.dataset.value) === normalize(value));
    return option ? option.textContent.trim() : 'Todo';
  };

  const closeMenu = () => {
    pickerWrap.classList.remove('is-open');
    button.setAttribute('aria-expanded', 'false');
  };

  const openMenu = () => {
    pickerWrap.classList.add('is-open');
    button.setAttribute('aria-expanded', 'true');
  };

  const setFilter = (value, updateUrl = true) => {
    const active = normalize(value);
    const cards = Array.from(list.querySelectorAll('.product-card'));

    cards.forEach((card) => {
      const category = normalize(card.getAttribute('data-category'));
      const show = active === 'todo' || category === active;
      card.classList.toggle('is-hidden', !show);
      if (show) {
        card.removeAttribute('hidden');
        card.style.removeProperty('display');
      } else {
        card.setAttribute('hidden', '');
        card.style.setProperty('display', 'none', 'important');
      }
    });

    document.querySelectorAll('.products-filter__item').forEach((filterButton) => {
      filterButton.classList.toggle('is-active', normalize(filterButton.dataset.filter) === active);
    });

    if (select.value !== active) select.value = active;
    valueLabel.textContent = labelFor(active);

    options.forEach((option) => {
      const selected = normalize(option.dataset.value) === active;
      option.classList.toggle('is-selected', selected);
      option.setAttribute('aria-selected', selected ? 'true' : 'false');
    });

    if (updateUrl) {
      const url = new URL(window.location.href);
      url.searchParams.set('filter', active);
      window.history.replaceState({}, '', url);
    }
  };

  button.addEventListener('click', (event) => {
    event.preventDefault();
    pickerWrap.classList.contains('is-open') ? closeMenu() : openMenu();
  });

  options.forEach((option) => {
    option.addEventListener('click', () => {
      setFilter(option.dataset.value);
      closeMenu();
    });
  });

  select.addEventListener('change', () => setFilter(select.value));

  document.querySelectorAll('.products-filter__item').forEach((filterButton) => {
    filterButton.addEventListener('click', () => setFilter(filterButton.dataset.filter));
  });

  document.addEventListener('click', (event) => {
    if (!control.contains(event.target)) closeMenu();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMenu();
  });

  const params = new URLSearchParams(window.location.search);
  requestAnimationFrame(() => setFilter(params.get('filter') || params.get('category') || select.value || 'todo', false));
})();


// Shop v2: show a dedicated empty state when the active category has no products.
(() => {
  const list = document.querySelector('.products-list');
  const empty = document.querySelector('[data-products-filter-empty]');
  if (!list || !empty) return;

  const updateEmptyState = () => {
    const cards = Array.from(list.querySelectorAll('.product-card'));
    const visibleCards = cards.filter((card) => !card.hidden && !card.classList.contains('is-hidden') && getComputedStyle(card).display !== 'none');
    empty.hidden = cards.length === 0 || visibleCards.length > 0;
  };

  const observer = new MutationObserver(() => requestAnimationFrame(updateEmptyState));
  observer.observe(list, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class', 'style'] });

  document.addEventListener('click', (event) => {
    if (event.target.closest('.products-filter__item, .products-picker__option')) {
      requestAnimationFrame(updateEmptyState);
    }
  });
  document.getElementById('products-category-picker')?.addEventListener('change', () => requestAnimationFrame(updateEmptyState));
  window.addEventListener('popstate', () => requestAnimationFrame(updateEmptyState));
  requestAnimationFrame(updateEmptyState);
})();
