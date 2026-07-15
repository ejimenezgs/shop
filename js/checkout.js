import {initializeApp,getApps} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import {getFirestore,collection,addDoc,serverTimestamp} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

const cfg=window.CASA_GLICK_FIREBASE_CONFIG;
const app=getApps().length?getApps()[0]:initializeApp(cfg);
const db=getFirestore(app);
const cart=window.CasaGlickCart;
let items=cart?.read?.()||[];
const form=document.querySelector('#checkout-form');
const error=document.querySelector('#checkout-error');
const summary=document.querySelector('#checkout-summary');
const submitButton=document.querySelector('#checkout-submit');
const money=v=>new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(Number(v)||0);
const folio=()=>`CG-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;

function validPrice(value){
  const number=Number(value);
  return Number.isFinite(number)&&number>0;
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
  renderSummary();
  await refreshPricesFromApi();
  renderSummary();
}

form.addEventListener('submit',async event=>{
  event.preventDefault();
  error.textContent='';
  submitButton.disabled=true;
  submitButton.textContent='Generando orden…';
  try{
    const data=Object.fromEntries(new FormData(form).entries());
    if(!/^\d{10}$/.test(data.phone||'')) throw new Error('PHONE_INVALID');
    const orderFolio=folio();
    const total=renderSummary();
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
    const order={
      folio:orderFolio,
      status:'Nueva',
      customer,
      items:orderItems,
      subtotal:Number(total)||0,
      total:Number(total)||0,
      createdAt:serverTimestamp(),
      createdAtClient:new Date().toISOString(),
      source:'web'
    };
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
    if(err?.message==='PHONE_INVALID'){
      error.textContent='Ingresa un teléfono válido de 10 números.';
    }else if(firebaseCode.includes('permission-denied')){
      error.textContent='Firebase rechazó la orden. Publica las reglas de Firestore incluidas en esta versión.';
    }else{
      error.textContent='No fue posible generar la orden. Revisa tu conexión e inténtalo de nuevo.';
    }
    submitButton.disabled=false;
    submitButton.textContent='Generar orden y continuar por WhatsApp';
  }
});

init();
