const form=document.querySelector('#order-status-form');
const input=document.querySelector('#order-status-folio');
const error=document.querySelector('#order-status-error');
const result=document.querySelector('#order-status-result');
const title=document.querySelector('#order-status-title');
const description=document.querySelector('#order-status-description');
const number=document.querySelector('#order-status-number');
const payment=document.querySelector('#order-status-payment');
const inventory=document.querySelector('#order-status-inventory');
const whatsapp=document.querySelector('#order-status-whatsapp');
const itemsContainer=document.querySelector('#order-status-items');
const totalElement=document.querySelector('#order-status-total');
const totalCaption=document.querySelector('#order-status-total-caption');
const totalLabel=document.querySelector('#order-status-total-label');
const params=new URLSearchParams(location.search);

const statusCopy={
  'Nueva':'Orden recibida',
  'Pendiente de pago':'Pago pendiente',
  'Pagada':'Pago confirmado',
  'Pagada - revisar inventario':'Revisión de inventario',
  'En preparación':'Preparando tu pedido',
  'Despachada':'Pedido despachado',
  'Entregada':'Pedido entregado',
  'Cancelada':'Orden cancelada'
};
const paymentCopy={paid:'Pagado',pending:'Pendiente',failed:'Fallido',expired:'Expirado',refunded:'Reembolsado'};
const inventoryCopy={reserved:'Productos apartados',reservation_failed:'Requiere revisión',dispatched:'Despachado',released:'Apartado liberado',pending:'Pendiente'};

function normalizeFolio(value){return String(value||'').trim().toUpperCase();}
function render(data){
  const folio=normalizeFolio(data.folio);
  title.textContent=statusCopy[data.status]||data.status||'Orden en proceso';
  description.textContent=data.message||'Tu orden está registrada. Puedes contactarnos si necesitas más información.';
  number.textContent=folio;
  payment.textContent=paymentCopy[data.paymentStatus]||data.paymentStatus||'No aplica';
  inventory.textContent=inventoryCopy[data.inventoryStatus]||data.inventoryStatus||'En seguimiento';

  const currency=data.currency||'MXN';
  const money=new Intl.NumberFormat('es-MX',{style:'currency',currency,maximumFractionDigits:2});
  const orderItems=Array.isArray(data.items)?data.items:[];
  itemsContainer.replaceChildren();
  orderItems.forEach(item=>{
    const row=document.createElement('article');
    row.className='order-status-item';
    const info=document.createElement('div');
    const name=document.createElement('strong');
    name.textContent=item.name||'Producto Casa Glick';
    const meta=document.createElement('span');
    const sku=item.sku?` · ${item.sku}`:'';
    meta.textContent=`Cantidad: ${Math.max(1,Number(item.quantity)||1)}${sku}`;
    info.append(name,meta);
    const amount=document.createElement('strong');
    amount.textContent=money.format(Number(item.lineTotal)||0);
    row.append(info,amount);
    itemsContainer.appendChild(row);
  });
  if(!orderItems.length){
    const empty=document.createElement('p');
    empty.className='order-status-items__empty';
    empty.textContent='El detalle de artículos no está disponible para esta orden.';
    itemsContainer.appendChild(empty);
  }
  const isPendingAssisted=data.status==='Nueva'||(data.paymentMethod==='assisted'&&data.paymentStatus!=='paid');
  const caption=isPendingAssisted?'Total a pagar':'Total de la orden';
  totalCaption.textContent=caption;
  totalLabel.textContent=caption;
  totalElement.textContent=money.format(Number(data.total)||0);

  whatsapp.href=`https://wa.me/525513004665?text=${encodeURIComponent(`Hola, quiero consultar el estado de mi orden ${folio}.`)}`;
  result.hidden=false;
}
async function lookup(folio){
  error.textContent='';result.hidden=true;
  const button=form.querySelector('button');button.disabled=true;button.textContent='Consultando…';
  try{
    const response=await fetch(`api/order-status.php?folio=${encodeURIComponent(folio)}`,{cache:'no-store'});
    const data=await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(data.error||'No pudimos consultar la orden.');
    render(data);
    history.replaceState(null,'',`order.html?folio=${encodeURIComponent(folio)}`);
  }catch(err){error.textContent=err.message||'No pudimos consultar la orden.';}
  finally{button.disabled=false;button.textContent='Ver orden';}
}
form.addEventListener('submit',event=>{event.preventDefault();const folio=normalizeFolio(input.value);if(!/^CG-[A-Z0-9-]{8,35}$/.test(folio)){error.textContent='Ingresa un número de orden válido.';return;}lookup(folio);});
const initial=normalizeFolio(params.get('folio'));if(initial){input.value=initial;lookup(initial);}
