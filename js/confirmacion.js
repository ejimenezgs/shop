(() => {
  const params = new URLSearchParams(window.location.search);
  const fallbackFolio = params.get('folio') || '';
  let confirmation = {};

  try {
    confirmation = JSON.parse(sessionStorage.getItem('casaGlickOrderConfirmation') || '{}');
  } catch (_) {
    confirmation = {};
  }

  const folio = confirmation.folio || fallbackFolio;
  const folioElement = document.querySelector('#confirmation-folio');
  const whatsappLink = document.querySelector('#confirmation-whatsapp');
  const viewOrderLink = document.querySelector('#confirmation-view-order');

  folioElement.textContent = folio || 'Orden confirmada';
  if (viewOrderLink) { viewOrderLink.href = folio ? `order.html?folio=${encodeURIComponent(folio)}` : 'order.html'; }

  const casaGlickWhatsapp = 'https://wa.me/525513004665';
  let message = `Hola, generé la orden ${folio || ''} en Casa Glick y quiero darle seguimiento.`;

  if (confirmation.whatsappUrl) {
    try {
      const storedUrl = new URL(confirmation.whatsappUrl);
      const storedMessage = storedUrl.searchParams.get('text');
      if (storedMessage) message = storedMessage;
    } catch (_) {}
  }

  whatsappLink.href = `${casaGlickWhatsapp}?text=${encodeURIComponent(message)}`;
})();
