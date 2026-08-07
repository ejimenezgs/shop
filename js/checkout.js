import {initializeApp,getApps} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import {getFirestore,collection,addDoc,serverTimestamp,getDoc,doc} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

const cfg=window.CASA_GLICK_FIREBASE_CONFIG;
const app=getApps().length?getApps()[0]:initializeApp(cfg);
const db=getFirestore(app);
const cart=window.CasaGlickCart;
let items=cart?.read?.()||[];
let stripeAvailable=false;
let checkoutMode='assisted';
let selectedPaymentMethod='';
const form=document.querySelector('#checkout-form');
const error=document.querySelector('#checkout-error');
const summary=document.querySelector('#checkout-summary');
const submitButton=document.querySelector('#checkout-submit');
const modeNote=document.querySelector('#checkout-mode-note');
const checkoutIntro=document.querySelector('#checkout-intro');
const firstNameInput=form?.elements?.name;
const lastNameInput=form?.elements?.lastName;
const postalInput=document.querySelector('#checkout-postal-code');
const postalMessage=document.querySelector('#checkout-postal-message');
const deliverySelect=form?.elements?.delivery;
const addressField=document.querySelector('#checkout-address-field');
const addressInput=document.querySelector('#checkout-address');
const shippingNote=document.querySelector('#checkout-shipping-note');
const stripeBanner=document.querySelector('#checkout-stripe-banner');
const paymentOptions=document.querySelector('#checkout-payment-options');
const money=v=>new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(Number(v)||0);
const folio=()=>`CG-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;
const STRIPE_PENDING_KEY='casaGlickStripePendingOrder';
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const randomHex=bytes=>{const values=new Uint8Array(bytes);crypto.getRandomValues(values);return Array.from(values,value=>value.toString(16).padStart(2,'0')).join('');};
const safeImage=value=>{try{const url=new URL(String(value||''),location.href);return url.protocol==='https:'||url.origin===location.origin?escapeHtml(url.href):'assets/product-placeholder-cg.png';}catch{return 'assets/product-placeholder-cg.png';}};

function validPrice(value){const number=Number(value);return Number.isFinite(number)&&number>0;}
function normalizePostal(value){return String(value||'').replace(/\D/g,'').slice(0,5);}
function validPostal(value){return /^\d{5}$/.test(normalizePostal(value));}
function isCdmxPostal(value){const cp=normalizePostal(value);if(!validPostal(cp))return false;const numeric=Number(cp);return numeric>=1000&&numeric<=16999;}
function isEstadoDeMexicoPostal(value){const cp=normalizePostal(value);if(!validPostal(cp))return false;const numeric=Number(cp);return numeric>=50000&&numeric<=57999;}
function supportsStripePostal(value){return isCdmxPostal(value)||isEstadoDeMexicoPostal(value);}
function regionLabel(value){return isCdmxPostal(value)?'CDMX':(isEstadoDeMexicoPostal(value)?'Estado de México':'fuera de cobertura');}
function homeDelivery(){return String(deliverySelect?.value||'')==='Envío a domicilio';}
function paymentMethodForRegion(){
  const postal=normalizePostal(postalInput?.value);
  const stripeRegion=supportsStripePostal(postal);
  if(stripeRegion){
    if(selectedPaymentMethod==='showroom_cod')return 'showroom_cod';
    return stripeAvailable?'stripe':'showroom_cod';
  }
  if(selectedPaymentMethod==='showroom_cod')return 'showroom_cod';
  return 'whatsapp_quote';
}
function renderPaymentOptions(){
  if(!paymentOptions)return;
  const postal=normalizePostal(postalInput?.value);
  if(!validPostal(postal)){
    selectedPaymentMethod='';
    paymentOptions.innerHTML='<p class="checkout-payment-placeholder">Ingresa tu código postal para ver las opciones disponibles.</p>';
    return;
  }
  const stripeRegion=supportsStripePostal(postal);
  const options=stripeRegion
    ? [
        ...(stripeAvailable?[{value:'stripe',title:'Stripe',copy:'Tarjeta de crédito o débito'}]:[]),
        {value:'showroom_cod',title:'Pago contra entrega en showroom',copy:'Generaremos tu orden y la coordinaremos por WhatsApp'}
      ]
    : [
        {value:'whatsapp_quote',title:'Cotización por WhatsApp',copy:'Un asesor confirmará envío, disponibilidad y forma de pago'},
        {value:'showroom_cod',title:'Pago contra entrega en showroom',copy:'Generaremos tu orden y la coordinaremos por WhatsApp'}
      ];
  const allowed=options.map(option=>option.value);
  if(!allowed.includes(selectedPaymentMethod))selectedPaymentMethod=options[0]?.value||'';
  paymentOptions.innerHTML=options.map(option=>`<label class="checkout-payment-option"><input type="radio" name="paymentMethod" value="${option.value}" ${option.value===selectedPaymentMethod?'checked':''}><span class="checkout-payment-option__control" aria-hidden="true"></span><span class="checkout-payment-option__copy"><strong>${option.title}</strong><small>${option.copy}</small></span></label>`).join('');
  paymentOptions.querySelectorAll('input[name="paymentMethod"]').forEach(input=>input.addEventListener('change',()=>{
    selectedPaymentMethod=input.value;
    if(selectedPaymentMethod==='showroom_cod'&&deliverySelect){
      deliverySelect.value='Recoger en showroom';
      updateDeliveryFields();
    }else{
      updateCheckoutMode();
    }
  }));
}
function readPendingStripeOrder(){try{const value=JSON.parse(sessionStorage.getItem(STRIPE_PENDING_KEY)||'null');return value&&typeof value==='object'?value:null;}catch{return null;}}
function stripeOrderSignature(orderItems,customer){return JSON.stringify({items:orderItems.map(item=>({code:String(item.code||''),quantity:Math.max(1,Number(item.quantity)||1)})).sort((a,b)=>a.code.localeCompare(b.code)),customer});}

function updateDeliveryFields(){
  const show=homeDelivery();
  addressField.hidden=!show;
  addressInput.required=show;
  if(!show)addressInput.value='';
  updateCheckoutMode();
}
function updateCheckoutMode(){
  const postal=normalizePostal(postalInput?.value);
  if(postalInput&&postalInput.value!==postal)postalInput.value=postal;
  const postalReady=validPostal(postal);
  const stripeRegion=postalReady&&supportsStripePostal(postal);
  renderPaymentOptions();
  const activePayment=paymentMethodForRegion();
  selectedPaymentMethod=activePayment;
  checkoutMode=activePayment==='stripe'&&stripeAvailable&&stripeRegion?'stripe':'assisted';
  shippingNote.hidden=!(stripeRegion&&homeDelivery());
  if(stripeBanner)stripeBanner.hidden=checkoutMode!=='stripe';
  modeNote.hidden=true;
  modeNote.textContent='';
  if(!postalReady){
    submitButton.textContent='Continuar';
    postalMessage.textContent='Ingresa tu código postal para definir el método de compra.';
    if(checkoutIntro)checkoutIntro.textContent='Captura tus datos para generar tu orden.';
    return;
  }
  if(stripeRegion){
    postalMessage.textContent=`Entrega disponible en ${regionLabel(postal)}.`;
  }else{
    postalMessage.textContent='Para entregas fuera de CDMX y Estado de México, un asesor confirmará envío y disponibilidad.';
  }
  if(activePayment==='stripe'){
    submitButton.textContent='Pagar con Stripe';
    if(checkoutIntro)checkoutIntro.textContent='Captura tus datos para validar disponibilidad y continuar a un pago seguro.';
  }else if(activePayment==='showroom_cod'){
    submitButton.textContent='Generar orden por WhatsApp';
    if(checkoutIntro)checkoutIntro.textContent='Captura tus datos para generar tu orden y coordinar el pago contra entrega en showroom.';
  }else{
    submitButton.textContent='Solicitar cotización por WhatsApp';
    if(checkoutIntro)checkoutIntro.textContent='Captura tus datos para generar tu orden y coordinar el envío por WhatsApp.';
  }
}

async function loadCheckoutMode(){try{const snapshot=await getDoc(doc(db,'catalogSettings','admin'));const settings=snapshot.exists()?snapshot.data():{};stripeAvailable=settings.stripeEnabled===true||settings.checkoutMode==='stripe';}catch(err){console.warn('No se pudo leer el modo de checkout. Se usará compra asistida.',err);stripeAvailable=false;}updateCheckoutMode();}
function renderSummary(){const total=items.reduce((sum,item)=>sum+(validPrice(item.price)?Number(item.price):0)*(Number(item.quantity)||0),0);summary.innerHTML=items.length?`<div class="checkout-summary-list">${items.map(item=>{const quantity=Number(item.quantity)||1;const hasPrice=validPrice(item.price);const lineTotal=hasPrice?Number(item.price)*quantity:0;return `<article class="checkout-summary-item"><img src="${safeImage(item.image)}" alt="${escapeHtml(item.name||item.code||'Producto Casa Glick')}"><span class="seo-image-caption">${escapeHtml(item.name||item.code||'Producto Casa Glick')}</span><div class="checkout-summary-item__copy"><strong>${escapeHtml(item.name||item.code||'Producto')}</strong><span>${quantity} × ${hasPrice?money(item.price):'Precio a cotizar'}</span></div><b>${hasPrice?money(lineTotal):'Cotizar'}</b></article>`;}).join('')}</div><div class="checkout-summary-total"><span>Total estimado</span><strong>${money(total)} MXN</strong></div>`:'<p>Tu bolsa está vacía.</p>';if(submitButton)submitButton.disabled=!items.length;return total;}
async function refreshPricesFromApi(){try{if(!window.CasaGlickCatalog?.fetchProducts)return;const products=await window.CasaGlickCatalog.fetchProducts();const byCode=new Map(products.map(product=>[String(product.code||product.id),product]));let changed=false;items=items.map(item=>{const fresh=byCode.get(String(item.code||item.id));if(!fresh)return item;const next={...item};if(validPrice(fresh.price)&&Number(next.price)!==Number(fresh.price)){next.price=Number(fresh.price);changed=true;}if(fresh.displayName||fresh.name)next.name=fresh.displayName||fresh.name;if(fresh.images?.[0])next.image=fresh.images[0];if(Number.isFinite(Number(fresh.stock)))next.stock=Number(fresh.stock);return next;});if(changed)cart?.write?.(items);}catch(err){console.warn('No fue posible actualizar precios desde la API.',err);}}
async function init(){renderSummary();updateDeliveryFields();await Promise.all([refreshPricesFromApi(),loadCheckoutMode()]);renderSummary();}
function cleanOrderData(data,total,orderFolio){const cleanText=value=>value==null?'':String(value).trim();const orderItems=items.map((item,index)=>({id:cleanText(item.id||item.code||`item-${index+1}`),code:cleanText(item.code||item.id),name:cleanText(item.name||item.code||'Producto'),price:validPrice(item.price)?Number(item.price):null,quantity:Math.max(1,Number(item.quantity)||1),image:cleanText(item.image)}));const postalCode=normalizePostal(data.postalCode);const firstName=cleanText(data.name);const lastName=cleanText(data.lastName);const fullName=[firstName,lastName].filter(Boolean).join(' ').trim();const customerRegion=isCdmxPostal(postalCode)?'cdmx':(isEstadoDeMexicoPostal(postalCode)?'edomex':'exterior');const customer={name:fullName,firstName,lastName,phone:cleanText(data.phone),email:cleanText(data.email),postalCode,address:cleanText(data.address),delivery:cleanText(data.delivery),comments:cleanText(data.comments),region:customerRegion,paymentSelection:selectedPaymentMethod};return{orderItems,customer,base:{folio:orderFolio,customer,items:orderItems,subtotal:Number(total)||0,total:Number(total)||0,createdAt:serverTimestamp(),createdAtClient:new Date().toISOString(),source:'web'}};}

postalInput?.addEventListener('input',updateCheckoutMode);
postalInput?.addEventListener('blur',updateCheckoutMode);
deliverySelect?.addEventListener('change',updateDeliveryFields);
form.addEventListener('submit',async event=>{
  event.preventDefault();error.textContent='';submitButton.disabled=true;
  const activeMode=checkoutMode;const activePayment=selectedPaymentMethod||paymentMethodForRegion();submitButton.textContent=activeMode==='stripe'?'Preparando pago…':'Generando orden…';
  try{
    const data=Object.fromEntries(new FormData(form).entries());
    if(!String(data.name||'').trim())throw new Error('NAME_REQUIRED');
    if(!String(data.lastName||'').trim())throw new Error('LASTNAME_REQUIRED');
    if(!/^\d{10}$/.test(data.phone||''))throw new Error('PHONE_INVALID');
    if(!validPostal(data.postalCode))throw new Error('POSTAL_INVALID');
    if(data.delivery==='Envío a domicilio'&&!String(data.address||'').trim())throw new Error('ADDRESS_REQUIRED');
    if(!items.length)throw new Error('EMPTY_CART');
    const orderFolio=folio();const total=renderSummary();const{orderItems,customer,base}=cleanOrderData(data,total,orderFolio);
    if(activeMode==='stripe'){
      if(!supportsStripePostal(customer.postalCode))throw new Error('STRIPE_COVERAGE_ONLY');
      if(orderItems.some(item=>!validPrice(item.price)))throw new Error('STRIPE_QUOTE_ITEM');
      const signature=stripeOrderSignature(orderItems,customer);const pending=readPendingStripeOrder();let orderId='';let activeFolio=orderFolio;
      if(pending?.signature===signature&&/^[A-Za-z0-9_-]{8,128}$/.test(String(pending.orderId||''))){orderId=String(pending.orderId);activeFolio=String(pending.folio||orderFolio);}else{const order={...base,status:'Pendiente de pago',paymentMethod:'stripe',paymentStatus:'pending',stripeSessionId:null,checkoutAttempt:0};const orderRef=await addDoc(collection(db,'orders'),order);orderId=orderRef.id;sessionStorage.setItem(STRIPE_PENDING_KEY,JSON.stringify({orderId,folio:activeFolio,signature}));}
      const response=await fetch('api/create-checkout-session.php',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderId})});const payload=await response.json().catch(()=>({}));if(!response.ok||!payload.url)throw new Error(payload.error||'STRIPE_SESSION_FAILED');sessionStorage.setItem(STRIPE_PENDING_KEY,JSON.stringify({orderId,folio:activeFolio,signature,sessionId:String(payload.sessionId||'')}));window.location.assign(payload.url);return;
    }
    const dispatchToken=randomHex(24);
    const assistedPaymentMethod=activePayment==='showroom_cod'?'showroom_cod':'whatsapp_quote';
    const order={...base,status:'Nueva',paymentMethod:assistedPaymentMethod,paymentStatus:'not_applicable',emailDispatchToken:dispatchToken,assistedRequestEmail:{status:'pending',attempts:0}};
    const orderRef=await addDoc(collection(db,'orders'),order);
    const lines=items.map(item=>{const quantity=Number(item.quantity)||1;return `• ${quantity} × ${item.name} (${item.code}) — ${validPrice(item.price)?money(Number(item.price)*quantity):'Precio a cotizar'}`;});
    const addressLine=data.delivery==='Envío a domicilio'?`\nDirección: ${data.address}`:'';
    const paymentLabel=activePayment==='showroom_cod'?'Pago contra entrega en showroom':'Cotización por WhatsApp';
    const text=`Hola, generé la solicitud ${orderFolio} en Casa Glick.\n\n${lines.join('\n')}\n\nTotal estimado: ${money(total)} MXN\nMétodo: ${paymentLabel}\nEntrega: ${data.delivery}\nCódigo Postal: ${customer.postalCode}${addressLine}\nCliente: ${customer.name}\nTeléfono: ${data.phone}`;
    let url=`https://wa.me/525514676585?text=${encodeURIComponent(text)}`;
    try{
      const notificationResponse=await fetch('api/send-assisted-order-emails.php',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderId:orderRef.id,dispatchToken})});
      const notificationPayload=await notificationResponse.json().catch(()=>({}));
      if(notificationResponse.ok&&notificationPayload.whatsappUrl)url=String(notificationPayload.whatsappUrl);
      else console.warn('No se pudo enviar el correo de solicitud:',notificationPayload.error||notificationResponse.status);
    }catch(notificationError){console.warn('No se pudo enviar el correo de solicitud:',notificationError);}
    sessionStorage.setItem('casaGlickOrderConfirmation',JSON.stringify({folio:orderFolio,whatsappUrl:url,total:Number(total)||0,itemCount:orderItems.reduce((sum,item)=>sum+item.quantity,0)}));cart.clear();window.location.href=`confirmacion.html?folio=${encodeURIComponent(orderFolio)}`;
  }catch(err){console.error('Error al generar la orden:',err);const firebaseCode=String(err?.code||'');if(err?.message==='NAME_REQUIRED')error.textContent='Ingresa tu nombre.';else if(err?.message==='LASTNAME_REQUIRED')error.textContent='Ingresa tu apellido.';else if(err?.message==='PHONE_INVALID')error.textContent='Ingresa un teléfono válido de 10 números.';else if(err?.message==='POSTAL_INVALID')error.textContent='Ingresa un código postal válido de 5 números.';else if(err?.message==='ADDRESS_REQUIRED')error.textContent='Ingresa la dirección completa para la entrega a domicilio.';else if(err?.message==='EMPTY_CART')error.textContent='Tu bolsa está vacía.';else if(err?.message==='STRIPE_COVERAGE_ONLY')error.textContent='El pago con Stripe está disponible únicamente para entregas en CDMX y Estado de México.';else if(err?.message==='STRIPE_QUOTE_ITEM')error.textContent='La bolsa contiene un producto que requiere cotización. Retíralo para pagar con Stripe.';else if(firebaseCode.includes('permission-denied'))error.textContent='Firebase rechazó la orden. Revisa las reglas de Firestore para el modo seleccionado.';else error.textContent=String(err?.message||'').startsWith('STRIPE_')?'No fue posible iniciar el pago. Inténtalo nuevamente.':(err?.message||'No fue posible procesar la orden. Revisa tu conexión e inténtalo de nuevo.');submitButton.disabled=false;updateCheckoutMode();}
});
init();
