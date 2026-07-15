const catalog = window.CasaGlickCatalog;
const config = window.CASA_GLICK_FIREBASE_CONFIG || {};
const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const categoryLabel = value => ({poltronas:'Poltronas',sillas:'Sillas',mesas:'Mesas',sofas:'Sofás',decoracion:'Decoración',iluminacion:'Iluminación'})[value] || 'Colección';
const money = value => value === null ? 'Precio a consultar' : new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN',minimumFractionDigits:2}).format(value);

function withTimeout(promise, milliseconds, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), milliseconds))
  ]);
}

async function readOverrides(){
  if (!config.projectId) return {};
  try{
    const [{ initializeApp, getApps }, { collection, getDocs, getFirestore }] = await withTimeout(
      Promise.all([
        import('https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js'),
        import('https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js')
      ]),
      7000,
      'Firebase tardó demasiado en cargar'
    );
    const app = getApps().length ? getApps()[0] : initializeApp(config);
    const snapshot = await withTimeout(
      getDocs(collection(getFirestore(app), 'catalogProductOverrides')),
      7000,
      'Firestore tardó demasiado en responder'
    );
    const result = {};
    snapshot.forEach(item => { result[item.id] = item.data(); });
    return result;
  } catch(error) {
    console.error('No se pudo leer la configuración pública desde Firebase', error);
    return {};
  }
}

const COLOR_MAP={blanco:'#f5f5f2',white:'#f5f5f2',marfil:'#eee9df',ivory:'#eee9df',beige:'#d8c6ad',arena:'#cbb99f',negro:'#222222',black:'#222222',oscuro:'#2c2c2c',gris:'#8a8a86',gray:'#8a8a86',grey:'#8a8a86',cafe:'#6f4b35','café':'#6f4b35',brown:'#6f4b35',camel:'#b58f70',cognac:'#9a5b32',chocolate:'#4a2f24',rojo:'#9e3f36',red:'#9e3f36',vino:'#6f2733',burgundy:'#6f2733',azul:'#45627a',blue:'#45627a',verde:'#5e7058',green:'#5e7058',olivo:'#72745a',olive:'#72745a',amarillo:'#d4b24f',yellow:'#d4b24f',naranja:'#c9773c',orange:'#c9773c',rosa:'#c98f9d',pink:'#c98f9d',morado:'#74607f',purple:'#74607f',dorado:'#b89a58',gold:'#b89a58',plateado:'#aaaeb0',silver:'#aaaeb0',natural:'#b89c7a'};
const colorItems=value=>{if(Array.isArray(value))return value.flatMap(colorItems);if(value&&typeof value==='object')return Object.values(value).flatMap(colorItems);const text=String(value??'').trim();if(!text||text==='—'||/^sin color$/i.test(text))return[];return text.split(/[,;|/\n]+/).map(v=>v.trim()).filter(Boolean)};
const colorHex=label=>{const value=String(label||'').trim();const hex=value.match(/#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})\b/i);if(hex)return hex[0];const normalized=value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();for(const[name,color]of Object.entries(COLOR_MAP)){const key=name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();if(normalized.includes(key))return color}return'#8a8178'};
function renderSwatches(product){const container=document.querySelector('[data-product-swatches]');if(!container)return;const unique=[];const seen=new Set();for(const item of colorItems(product.color)){const key=item.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();if(!seen.has(key)){seen.add(key);unique.push(item)}}const colors=unique.length?unique:['Blanco','Oscuro'];container.innerHTML=colors.map((label,index)=>`<button class="product-swatch${index===0?' is-active':''}" type="button" aria-label="${esc(label)}" title="${esc(label)}" style="--swatch:${esc(colorHex(label))}"></button>`).join('')}
function applyOverride(product,overrides){const o=overrides[product.id]||{};return{...product,published:o.published===true,category:product.category||'',displayName:o.displayName||product.name,editorialDescription:o.editorialDescription||product.description,order:Number(o.order)||0,slug:o.slug||product.slug}}

async function loadPublicProducts() {
  if (!catalog) throw new Error('CasaGlickCatalog no está disponible');
  const [productsResult, overridesResult] = await Promise.allSettled([
    withTimeout(catalog.fetchProducts(), 12000, 'La API del inventario tardó demasiado en responder'),
    readOverrides()
  ]);
  if (productsResult.status === 'rejected') throw productsResult.reason;
  const overrides = overridesResult.status === 'fulfilled' ? overridesResult.value : {};
  return productsResult.value.map(product => applyOverride(product, overrides));
}

async function renderListing(){
  const list=document.querySelector('.products-list');
  if(!list)return;
  list.setAttribute('aria-busy','true');
  try{
    const products=(await loadPublicProducts())
      .filter(product=>product.published)
      .sort((a,b)=>a.order-b.order||a.displayName.localeCompare(b.displayName,'es'));
    list.innerHTML=products.map(p=>`<article class="product-card" data-category="${esc(p.category||'todo')}" data-brand="${esc(p.brand)}"><a class="product-card__link" href="producto.html?product=${encodeURIComponent(p.code)}" aria-label="Ver detalle de ${esc(p.displayName)}"><img src="${esc(p.images[0])}" alt="${esc(p.displayName)} Casa Glick" loading="lazy" onerror="this.onerror=null;this.src='${catalog.FALLBACK_IMAGE}'" /><span class="product-card__meta"><strong>${esc(p.displayName)}</strong><small>${esc(categoryLabel(p.category))}</small></span></a></article>`).join('');
    if(!products.length)list.innerHTML='<p class="products-empty">No hay productos publicados por el momento.</p>';
    const picker=document.getElementById('products-category-picker');
    if(picker)picker.dispatchEvent(new Event('change',{bubbles:true}));
  }catch(error){
    console.error('No se pudo cargar el catálogo público',error);
    list.innerHTML='<p class="products-empty">No fue posible cargar los productos. Recarga la página para intentarlo nuevamente.</p>';
  }finally{
    list.removeAttribute('aria-busy');
  }
}

async function renderDetail(){
  const root=document.querySelector('.product-detail');if(!root)return;
  const key=new URLSearchParams(location.search).get('product')||new URLSearchParams(location.search).get('id');if(!key)return;
  try{
    const products=await loadPublicProducts();
    const product=products.find(p=>String(p.code).toLowerCase()===String(key).toLowerCase()||p.slug===key);
    if(!product)throw new Error('Producto no encontrado');
    document.querySelectorAll('[data-product-title]').forEach(n=>n.textContent=product.displayName);
    const set=(selector,value)=>{const n=document.querySelector(selector);if(n)n.textContent=value||'—'};
    set('[data-product-description]',product.editorialDescription);set('[data-product-materials]',product.materials);set('[data-product-measures]',product.measures);set('[data-product-breadcrumb-name]',product.displayName);
    const categoryLink=document.querySelector('[data-product-category-link]');if(categoryLink){categoryLink.textContent=categoryLabel(product.category);categoryLink.href=`productos.html?filter=${product.category||'todo'}`}
    const hasStock=Number(product.stock)>0;const priceNode=document.querySelector('[data-product-price]');if(priceNode)priceNode.textContent=hasStock?money(product.price):'Sin stock';
    const priceBlock=document.querySelector('[data-product-price-block]');if(priceBlock){priceBlock.hidden=false;priceBlock.classList.add('is-visible')}
    const stockNode=document.querySelector('[data-product-stock]');if(stockNode){stockNode.textContent=hasStock?`${product.stock} disponibles`:'';stockNode.hidden=!hasStock}
    renderSwatches(product);
    const gallery=document.querySelector('.product-gallery');if(gallery){const availableImages=Array.isArray(product.images)&&product.images.length?product.images.filter(Boolean):[catalog.FALLBACK_IMAGE];gallery.innerHTML=availableImages.map((src,index)=>`<figure class="product-gallery__item${index===0?' product-gallery__item--hero':''}"><img data-product-image="${index}" src="${esc(src)}" alt="${esc(product.displayName)} Casa Glick${index?`, vista ${index+1}`:''}" loading="${index===0?'eager':'lazy'}" onerror="this.onerror=null;this.src='${catalog.FALLBACK_IMAGE}'" /></figure>`).join('');gallery.removeAttribute('aria-busy');document.dispatchEvent(new CustomEvent('casa-glick:gallery-updated'))}
    const quote=document.querySelector('[data-product-quote]');if(quote){const hasPrice=product.price!==null&&Number.isFinite(Number(product.price));const canAdd=hasStock&&hasPrice;if(canAdd){quote.textContent='Agregar al carrito';quote.href='bolsa.html';quote.removeAttribute('target');quote.removeAttribute('rel');quote.onclick=event=>{event.preventDefault();window.CasaGlickCart?.add({id:product.id,code:product.code,name:product.displayName,price:Number(product.price),image:(product.images&&product.images[0])||catalog.FALLBACK_IMAGE,stock:Number(product.stock)});quote.classList.add('is-added');quote.textContent='Agregado al carrito';setTimeout(()=>{quote.classList.remove('is-added');quote.textContent='Agregar al carrito'},1300)}}else{quote.textContent='Cotizar';quote.target='_blank';quote.rel='noopener';quote.onclick=null;const reason=!hasStock?'sin stock':'sin precio';quote.href=`https://wa.me/525513004665?text=${encodeURIComponent(`Hola, quiero cotizar ${product.displayName} (${product.code}) de Casa Glick. Actualmente aparece ${reason}.`)}`}}
  }catch(error){console.error('No se pudo cargar el producto',error)}
}

renderListing();
renderDetail();
