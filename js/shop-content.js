import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import {
  doc,
  getFirestore,
  onSnapshot
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

const firebaseConfig = window.CASA_GLICK_FIREBASE_CONFIG;

const sectionMap = {
  hero: {
    root: '[data-section="hero"]',
    image: '[data-content="hero-image"] img',
    imageSource: '[data-content="hero-image"] source'
  },
  products: {
    root: '[data-section="products"]',
    title: '[data-content="products-title"]',
    description: ['[data-content="products-description"]'],
    button: '[data-content="products-button"]'
  },
  showroom: {
    root: '[data-section="showroom"]',
    title: '[data-content="showroom-title"]',
    description: ['[data-content="showroom-description"]'],
    button: '[data-content="showroom-button"]',
    image: '[data-content="showroom-image"]'
  },
  about: {
    root: '[data-section="about"]',
    title: '[data-content="about-title"]',
    description: [
      '[data-content="about-description"]',
      '[data-content="about-description-extra"]'
    ],
    button: '[data-content="about-button"]',
    image: '[data-content="about-image"]'
  },
  brands: {
    root: '[data-section="brands"]',
    image: '[data-content="brands-image"]'
  },
  contact: {
    root: '[data-section="contact"]',
    eyebrow: '[data-content="contact-eyebrow"]',
    title: '[data-content="contact-title"]',
    button: '[data-content="contact-button"]',
    image: '[data-content="contact-image"]'
  }
};

const originals = new WeakMap();

function remember(element) {
  if (!element || originals.has(element)) return;
  originals.set(element, {
    text: element.textContent,
    hidden: element.hidden,
    href: element.getAttribute?.('href'),
    src: element.getAttribute?.('src'),
    srcset: element.getAttribute?.('srcset')
  });
}

function trimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isSafeLink(value) {
  const url = trimmedString(value);
  if (!url) return false;
  if (/^(javascript|data|file):/i.test(url)) return false;
  if (/^(https:\/\/|\/|\.\/|\.\.\/|#)/i.test(url)) return true;
  return /^(index|productos|producto|bolsa|checkout|confirmacion|checkout-success|checkout-cancel)\.html(?:[?#].*)?$/i.test(url);
}

function isSafeImageUrl(value) {
  const url = trimmedString(value);
  if (!url || /^(javascript|data|file):/i.test(url)) return false;
  return /^(https:\/\/|\/|\.\/|\.\.\/|assets\/)/i.test(url);
}

function setText(element, value) {
  const text = trimmedString(value);
  if (!element || !text) return;
  remember(element);

  const childSpans = Array.from(element.children).filter((child) => child.tagName === 'SPAN');
  if (!childSpans.length) {
    if (element.textContent !== text) element.textContent = text;
    return;
  }

  const parts = text.split(/\s*\|\s*|\n+/).map((part) => part.trim()).filter(Boolean);
  if (parts.length > 1) {
    childSpans.forEach((span, index) => {
      span.textContent = parts[index] || '';
      span.hidden = !parts[index];
    });
  } else {
    childSpans[0].textContent = text;
    childSpans[0].hidden = false;
    childSpans.slice(1).forEach((span) => {
      span.textContent = '';
      span.hidden = true;
    });
  }
}

function setDescription(selectors, value) {
  const text = trimmedString(value);
  if (!text || !Array.isArray(selectors)) return;
  const elements = selectors.map((selector) => document.querySelector(selector)).filter(Boolean);
  if (!elements.length) return;
  const parts = text.split(/\n{2,}|\n/).map((part) => part.trim()).filter(Boolean);

  elements.forEach((element, index) => {
    remember(element);
    if (index < parts.length) {
      element.textContent = parts[index];
      element.hidden = false;
    } else if (parts.length === 1 && index === 0) {
      element.textContent = parts[0];
      element.hidden = false;
    } else {
      element.hidden = true;
    }
  });
}

function setButton(element, section) {
  if (!element || !section || typeof section !== 'object') return;
  const buttonText = trimmedString(section.buttonText);
  const buttonUrl = trimmedString(section.buttonUrl);

  if (buttonText) {
    remember(element);
    const textNodeTarget = element.querySelector('span:not([aria-hidden="true"])');
    if (textNodeTarget) textNodeTarget.textContent = buttonText;
    else element.textContent = buttonText;
  }

  if (element.tagName === 'A' && isSafeLink(buttonUrl)) {
    remember(element);
    if (element.getAttribute('href') !== buttonUrl) element.setAttribute('href', buttonUrl);
  }
}

function setImage(image, source, value) {
  const url = trimmedString(value);
  if (!image || !isSafeImageUrl(url)) return;
  remember(image);
  if (source) remember(source);

  const originalSrc = originals.get(image)?.src || image.getAttribute('src');
  const originalSrcset = source ? (originals.get(source)?.srcset || source.getAttribute('srcset')) : null;

  const restore = () => {
    if (originalSrc) image.setAttribute('src', originalSrc);
    if (source && originalSrcset) source.setAttribute('srcset', originalSrcset);
  };

  const probe = new Image();
  probe.onload = () => {
    if (image.getAttribute('src') !== url) image.setAttribute('src', url);
    if (source && source.getAttribute('srcset') !== url) source.setAttribute('srcset', url);
  };
  probe.onerror = restore;
  probe.src = url;
}

function applySection(name, section) {
  if (!section || typeof section !== 'object') return;
  const map = sectionMap[name];
  if (!map) return;

  const root = document.querySelector(map.root);
  if (!root) return;
  remember(root);

  const enabledValue = section.enabled;
  const isDisabled = enabledValue === false || enabledValue === 0 || enabledValue === "false";
  const isEnabled = enabledValue === true || enabledValue === 1 || enabledValue === "true";

  if (isDisabled) {
    root.hidden = true;
    root.classList.add('is-shop-content-disabled');
    root.setAttribute('aria-hidden', 'true');
  } else if (isEnabled) {
    root.hidden = false;
    root.classList.remove('is-shop-content-disabled');
    root.removeAttribute('aria-hidden');
  }

  if (map.eyebrow) setText(document.querySelector(map.eyebrow), section.eyebrow);
  if (map.title) setText(document.querySelector(map.title), section.title);
  if (map.description) setDescription(map.description, section.description);
  if (map.button) setButton(document.querySelector(map.button), section);
  if (map.image) {
    setImage(
      document.querySelector(map.image),
      map.imageSource ? document.querySelector(map.imageSource) : null,
      section.imageUrl
    );
  }
}

function applyShopContent(content) {
  if (!content || typeof content !== 'object') return;
  const nested = content.sections && typeof content.sections === 'object' ? content.sections : {};
  Object.keys(sectionMap).forEach((name) => {
    const directSection = content[name] && typeof content[name] === 'object' ? content[name] : null;
    const nestedSection = nested[name] && typeof nested[name] === 'object' ? nested[name] : null;
    applySection(name, directSection || nestedSection || {});
  });
}

if (firebaseConfig?.projectId) {
  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  const db = getFirestore(app);
  const contentRef = doc(db, 'shopContent', 'home');

  onSnapshot(
    contentRef,
    (snapshot) => {
      if (!snapshot.exists()) return;
      applyShopContent(snapshot.data());
    },
    (error) => {
      console.error('No se pudo cargar Web Design:', error);
    }
  );
}
