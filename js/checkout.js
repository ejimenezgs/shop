import {initializeApp,getApps} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import {getFirestore,collection,addDoc,serverTimestamp,getDoc,doc} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

const cfg=window.CASA_GLICK_FIREBASE_CONFIG;
const app=getApps().length?getApps()[0]:initializeApp(cfg);
const db=getFirestore(app);
const cart=window.CasaGlickCart;
let items=cart?.read?.()||[];
let checkoutMode='assisted';
const form=document.querySelector('#checkout-form');
const error=document.querySelector('#checkout-error');
const summary=document.querySelector('#checkout-summary');
const submitButton=document.querySelector('#checkout-submit');
const modeNote=document.querySelector('#checkout-mode-note');
const checkoutIntro=document.querySelector('#checkout-intro');
const money=v=>new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(Number(v)||0);
const folio=()=>`CG-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;

function validPrice(value){
  const number=Number(value);
  return Number.isFinite(number)&&number>0;
}

function setMode(mode){
  checkoutMode=mode==='stripe'?'stripe':'assisted';
  if(checkoutMode==='stripe'){
    submitButton.textContent='Pagar con Stripe';
    modeNote.hidden=false;
    modeNote.textContent='Pago seguro procesado por Stripe';
    if(checkoutIntro) checkoutIntro.textContent='Captura tus datos para validar disponibilidad y continuar a un pago seguro.';
  }else{
    submitButton.textContent='Generar orden';
    modeNote.hidden=true;
    if(checkoutIntro) checkoutIntro.textContent='Captura tus datos para generar tu orden y continuar por WhatsApp con un asesor.';
  }
}

async function loadCheckoutMode(){
  try{
    const snapshot=await getDoc(doc(db,'catalogSettings','admin'));
    const settings=snapshot.exists()?snapshot.data():{};
    const stripeEnabled=settings.stripeEnabled===true||settings.checkoutMode==='stripe';
    setMode(stripeEnabled?'stripe':'assisted');
  }catch(err){
    console.warn('No se pudo leer el modo de checkout. Se usará compra asistida.',err);
    setMode('assisted');
  }
}

function renderSummary(){
  const total=items.reduce((sum,item)=>sum+(validPrice(item.price)?Number(item.price):0)*(Number(item.quantity)||0),0);
  summary.innerHTML=items.length
    ? `<div class="checkout-summary-list">${items.map((item)=>{
        const quantity=Number(item.quantity)||1;
        const hasPrice=validPrice(item.price);
        const lineTotal=hasPrice?Number(item.price)*quantity:0;
        return `<article class="checkout-summary-item">
          <img src="${item.image||'assets/product-placeholder-cg.png'}" alt="">
          <div class="checkout-summary-item__copy">
            <strong>${item.name||item.code||'Producto'}</strong>
            <span>${quantity} × ${hasPrice?money(item.price):'Precio a cotizar'}</span>
          </div>
          <b>${hasPrice?money(lineTotal):'Cotizar'}</b>
        </article>`;
      }).join('')}</div>
      <div class="checkout-summary-total"><span>Total estimado</span><strong>${money(total)} MXN</strong></div>`
    : '<p>Tu bolsa está vacía.</p>';
  if(submitButton) submitButton.disabled=!items.length;
  return total;
}

async function refreshPricesFromApi(){
  try{
    if(!window.CasaGlickCatalog?.fetchProducts) return;
    const products=await window.CasaGlickCatalog.fetchProducts();
    const byCode=new Map(products.map(product=>[String(product.code||product.id),product]));
    let changed=false;
    items=items.map(item=>{
      const fresh=byCode.get(String(item.code||item.id));
      if(!fresh) return item;
      const next={...item};
      if(validPrice(fresh.price)&&Number(next.price)!==Number(fresh.price)){next.price=Number(fresh.price);changed=true;}
      if(fresh.displayName||fresh.name) next.name=fresh.displayName||fresh.name;
      if(fresh.images?.[0]) next.image=fresh.images[0];
      if(Number.isFinite(Number(fresh.stock))) next.stock=Number(fresh.stock);
      return next;
    });
    if(changed) cart?.write?.(items);
  }catch(err){
    console.warn('No fue posible actualizar precios desde la API.',err);
  }
}

async function init(){
  setMode('assisted');
  renderSummary();
  await Promise.all([refreshPricesFromApi(),loadCheckoutMode()]);
  renderSummary();
}

function cleanOrderData(data,total,orderFolio){
  const cleanText=value=>value==null?'':String(value).trim();
  const orderItems=items.map((item,index)=>({
    id:cleanText(item.id||item.code||`item-${index+1}`),
    code:cleanText(item.code||item.id),
    name:cleanText(item.name||item.code||'Producto'),
    price:validPrice(item.price)?Number(item.price):null,
    quantity:Math.max(1,Number(item.quantity)||1),
    image:cleanText(item.image)
  }));
  const customer={
    name:cleanText(data.name),
    phone:cleanText(data.phone),
    email:cleanText(data.email),
    city:cleanText(data.city),
    delivery:cleanText(data.delivery),
    comments:cleanText(data.comments)
  };
  return {orderItems,customer,base:{
    folio:orderFolio,
    customer,
    items:orderItems,
    subtotal:Number(total)||0,
    total:Number(total)||0,
    createdAt:serverTimestamp(),
    createdAtClient:new Date().toISOString(),
    source:'web'
  }};
}

form.addEventListener('submit',async event=>{
  event.preventDefault();
  error.textContent='';
  submitButton.disabled=true;
  const originalMode=checkoutMode;
  submitButton.textContent=originalMode==='stripe'?'Preparando pago…':'Generando orden…';
  try{
    const data=Object.fromEntries(new FormData(form).entries());
    if(!/^\d{10}$/.test(data.phone||'')) throw new Error('PHONE_INVALID');
    if(!items.length) throw new Error('EMPTY_CART');
    const orderFolio=folio();
    const total=renderSummary();
    const {orderItems,customer,base}=cleanOrderData(data,total,orderFolio);

    if(originalMode==='stripe'){
      if(orderItems.some(item=>!validPrice(item.price))) throw new Error('STRIPE_QUOTE_ITEM');
      const order={
        ...base,
        status:'Pendiente de pago',
        paymentMethod:'stripe',
        paymentStatus:'pending',
        stripeSessionId:null
      };
      const orderRef=await addDoc(collection(db,'orders'),order);
      const response=await fetch('api/create-checkout-session.php',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({orderId:orderRef.id})
      });
      const payload=await response.json().catch(()=>({}));
      if(!response.ok||!payload.url) throw new Error(payload.error||'STRIPE_SESSION_FAILED');
      sessionStorage.setItem('casaGlickStripePendingOrder',JSON.stringify({orderId:orderRef.id,folio:orderFolio}));
      window.location.assign(payload.url);
      return;
    }

    const order={...base,status:'Nueva'};
    await addDoc(collection(db,'orders'),order);
    const lines=items.map(item=>{
      const quantity=Number(item.quantity)||1;
      return `• ${quantity} × ${item.name} (${item.code}) — ${validPrice(item.price)?money(Number(item.price)*quantity):'Precio a cotizar'}`;
    });
    const text=`Hola, generé la orden ${orderFolio} en Casa Glick.\n\n${lines.join('\n')}\n\nTotal estimado: ${money(total)} MXN\nEntrega: ${data.delivery}\nCliente: ${data.name}\nTeléfono: ${data.phone}`;
    const url=`https://wa.me/525513004665?text=${encodeURIComponent(text)}`;
    sessionStorage.setItem('casaGlickOrderConfirmation',JSON.stringify({
      folio:orderFolio,
      whatsappUrl:url,
      total:Number(total)||0,
      itemCount:orderItems.reduce((sum,item)=>sum+item.quantity,0)
    }));
    cart.clear();
    window.location.href=`confirmacion.html?folio=${encodeURIComponent(orderFolio)}`;
  }catch(err){
    console.error('Error al generar la orden:',err);
    const firebaseCode=String(err?.code||'');
    if(err?.message==='PHONE_INVALID') error.textContent='Ingresa un teléfono válido de 10 números.';
    else if(err?.message==='EMPTY_CART') error.textContent='Tu bolsa está vacía.';
    else if(err?.message==='STRIPE_QUOTE_ITEM') error.textContent='La bolsa contiene un producto que requiere cotización. Retíralo para pagar con Stripe o desactiva Stripe desde el panel.';
    else if(firebaseCode.includes('permission-denied')) error.textContent='Firebase rechazó la orden. Revisa las reglas de Firestore para el modo seleccionado.';
    else error.textContent=String(err?.message||'').startsWith('STRIPE_')?'No fue posible iniciar el pago. Inténtalo nuevamente.':(err?.message||'No fue posible procesar la orden. Revisa tu conexión e inténtalo de nuevo.');
    submitButton.disabled=false;
    setMode(originalMode);
  }
});

init();
