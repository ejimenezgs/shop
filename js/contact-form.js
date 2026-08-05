import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import {
  addDoc,
  collection,
  getFirestore,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

const form = document.getElementById('landing-contact-form');

if (form) {
  const firebaseConfig = window.CASA_GLICK_FIREBASE_CONFIG;
  const submitButton = form.querySelector('.contact-form__submit');
  const statusElement = document.getElementById('contact-form-status');
  const defaultButtonLabel = submitButton?.textContent?.trim() || 'Enviar';

  const setStatus = (message = '', type = '') => {
    if (!statusElement) return;
    statusElement.textContent = message;
    statusElement.classList.remove('is-error', 'is-success');
    if (type) statusElement.classList.add(`is-${type}`);
  };

  const setSubmitting = (isSubmitting) => {
    if (!submitButton) return;
    submitButton.disabled = isSubmitting;
    submitButton.setAttribute('aria-busy', String(isSubmitting));
    submitButton.textContent = isSubmitting ? 'Enviando…' : defaultButtonLabel;
  };

  const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setStatus();

    const data = new FormData(form);
    const name = String(data.get('nombre') || '').trim();
    const email = String(data.get('correo') || '').trim();
    const phone = String(data.get('telefono') || '').trim();
    const message = String(data.get('mensaje') || '').trim();

    if (name.length < 2) {
      setStatus('Escribe un nombre de al menos 2 caracteres.', 'error');
      form.elements.nombre?.focus();
      return;
    }

    if (!isValidEmail(email)) {
      setStatus('Escribe un correo electrónico válido.', 'error');
      form.elements.correo?.focus();
      return;
    }

    if (phone.length > 30) {
      setStatus('El teléfono no puede superar los 30 caracteres.', 'error');
      form.elements.telefono?.focus();
      return;
    }

    if (message.length < 2 || message.length > 3000) {
      setStatus('El mensaje debe tener entre 2 y 3000 caracteres.', 'error');
      form.elements.mensaje?.focus();
      return;
    }

    if (!firebaseConfig?.projectId) {
      setStatus('No fue posible conectar con el servicio de mensajes. Intenta nuevamente.', 'error');
      return;
    }

    setSubmitting(true);
    setStatus('Enviando mensaje…');

    try {
      const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
      const db = getFirestore(app);

      await addDoc(collection(db, 'contactMessages'), {
        name,
        email,
        phone,
        message,
        source: 'shop.casaglick.com',
        status: 'unread',
        createdAt: serverTimestamp()
      });

      form.reset();
      setStatus('Tu mensaje fue enviado correctamente. Pronto nos pondremos en contacto contigo.', 'success');
    } catch (error) {
      console.error('No se pudo guardar el mensaje de contacto en Firebase.', error);
      setStatus('No pudimos enviar tu mensaje. Revisa tu conexión e inténtalo nuevamente.', 'error');
    } finally {
      setSubmitting(false);
    }
  });
}
