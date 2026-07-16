
window.addEventListener('error', (event) => {
  console.error('Admin startup error:', event.error || event.message);
  document.body.classList.remove('auth-loading', 'auth-signed-in');
  document.body.classList.add('auth-signed-out');
  const target = document.querySelector('#login-error');
  if (target && !target.textContent) {
    target.textContent = 'No fue posible iniciar el administrador. Recarga la página o revisa la conexión.';
    target.classList.add('is-visible');
  }
});
window.addEventListener('unhandledrejection', (event) => {
  console.error('Admin startup rejection:', event.reason);
  document.body.classList.remove('auth-loading', 'auth-signed-in');
  document.body.classList.add('auth-signed-out');
});

import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import {
  browserLocalPersistence,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';

const config = window.CASA_GLICK_FIREBASE_CONFIG || {};
const loginForm = document.querySelector('#login-form');
const emailInput = document.querySelector('#login-email');
const passwordInput = document.querySelector('#login-password');
const submitButton = document.querySelector('#login-submit');
const errorElement = document.querySelector('#login-error');
const passwordToggle = document.querySelector('#password-toggle');
let adminLoaded = false;

function icons() {
  window.lucide?.createIcons?.({ attrs: { 'aria-hidden': 'true' } });
}

function isConfigured() {
  return ['apiKey', 'authDomain', 'projectId', 'appId'].every((key) => String(config[key] || '').trim());
}

function setError(message = '') {
  errorElement.textContent = message;
  errorElement.classList.toggle('is-visible', Boolean(message));
}

function setLoading(loading) {
  submitButton.disabled = loading;
  submitButton.classList.toggle('is-loading', loading);
  submitButton.querySelector('span').textContent = loading ? 'Ingresando…' : 'Ingresar';
}

function loadAdmin() {
  if (adminLoaded) return;
  adminLoaded = true;
  const script = document.createElement('script');
  script.src = 'js/admin.js?v=8';
  script.defer = true;
  document.body.appendChild(script);
}

function showAdmin(user) {
  document.body.classList.remove('auth-loading', 'auth-signed-out');
  document.body.classList.add('auth-signed-in');
  document.body.dataset.userEmail = user.email || '';
  loadAdmin();
  icons();
}

function showLogin() {
  document.body.classList.remove('auth-loading', 'auth-signed-in');
  document.body.classList.add('auth-signed-out');
  passwordInput.value = '';
  setLoading(false);
  setTimeout(() => emailInput.focus(), 80);
  icons();
}

function authErrorMessage(error) {
  const code = error?.code || '';
  if (code === 'auth/invalid-credential' || code === 'auth/user-not-found' || code === 'auth/wrong-password') return 'El correo o la contraseña no son correctos.';
  if (code === 'auth/invalid-email') return 'Ingresa un correo electrónico válido.';
  if (code === 'auth/too-many-requests') return 'Demasiados intentos. Espera unos minutos y vuelve a intentarlo.';
  if (code === 'auth/network-request-failed') return 'No fue posible conectarse. Revisa tu conexión a internet.';
  return 'No fue posible iniciar sesión. Inténtalo nuevamente.';
}

icons();

if (!isConfigured()) {
  document.body.classList.remove('auth-loading');
  document.body.classList.add('auth-signed-out');
  setError('Falta configurar Firebase en js/firebase-config.js.');
  submitButton.disabled = true;
} else {
  const app = initializeApp(config);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const overridesCollection = collection(db, 'catalogProductOverrides');
  const settingsRef = doc(db, 'catalogSettings', 'admin');

  window.CasaGlickFirestore = {
    async loadOverrides() {
      const snapshot = await getDocs(overridesCollection);
      const result = {};
      snapshot.forEach((item) => { result[item.id] = item.data(); });
      return result;
    },
    async saveOverride(productId, data) {
      await setDoc(doc(db, 'catalogProductOverrides', productId), {
        ...data,
        updatedAt: serverTimestamp(),
        updatedBy: auth.currentUser?.email || ''
      }, { merge: true });
    },
    async saveOverridesBulk(entries) {
      const chunks = [];
      for (let i = 0; i < entries.length; i += 450) chunks.push(entries.slice(i, i + 450));
      for (const chunk of chunks) {
        const batch = writeBatch(db);
        chunk.forEach(({ id, data }) => {
          batch.set(doc(db, 'catalogProductOverrides', id), {
            ...data,
            updatedAt: serverTimestamp(),
            updatedBy: auth.currentUser?.email || ''
          }, { merge: true });
        });
        await batch.commit();
      }
    },
    async loadSettings() {
      const snapshot = await getDoc(settingsRef);
      return snapshot.exists() ? snapshot.data() : {};
    },
    async saveSettings(data) {
      await setDoc(settingsRef, {
        ...data,
        updatedAt: serverTimestamp(),
        updatedBy: auth.currentUser?.email || ''
      }, { merge: true });
    },
    async loadOrders() {
      const snapshot = await getDocs(query(collection(db, 'orders'), orderBy('createdAt', 'desc')));
      return snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
    },
    async updateOrderStatus(orderId, status) {
      await updateDoc(doc(db, 'orders', orderId), {
        status,
        updatedAt: serverTimestamp(),
        updatedBy: auth.currentUser?.email || ''
      });
    }
  };

  setPersistence(auth, browserLocalPersistence).catch(console.error);

  onAuthStateChanged(auth, (user) => {
    if (user) showAdmin(user);
    else showLogin();
  });

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setError('');
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    if (!email || !password) {
      setError('Completa tu correo y contraseña.');
      return;
    }
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
      setError(authErrorMessage(error));
      setLoading(false);
    }
  });

  document.addEventListener('click', async (event) => {
    if (!event.target.closest('#logout-button')) return;
    await signOut(auth);
  });
}

passwordToggle.addEventListener('click', () => {
  const hidden = passwordInput.type === 'password';
  passwordInput.type = hidden ? 'text' : 'password';
  passwordToggle.setAttribute('aria-label', hidden ? 'Ocultar contraseña' : 'Mostrar contraseña');
  passwordToggle.innerHTML = `<i data-lucide="${hidden ? 'eye-off' : 'eye'}"></i>`;
  icons();
});
