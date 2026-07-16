const catalog = window.CasaGlickCatalog;
const config = window.CASA_GLICK_FIREBASE_CONFIG || {};
const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const categoryLabel = value => ({interior:'Interior',exterior:'Exterior',habitacion:'Habitación',decoracion:'Decoración',iluminacion:'Iluminación'})[value] || 'Colección';
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
    const addKey = (key, value) => {
      const clean = String(key ?? '').trim().toLowerCase();
      if (clean) result[clean] = value;
    };
    snapshot.forEach(item => {
      const data = item.data();
      addKey(item.id, data);
      addKey(data.code, data);
      addKey(data.codigo, data);
      addKey(data.sku, data);
      addKey(data.productId, data);
      addKey(data.idProducto, data);
      addKey(data.slug, data);
    });
    return result;
  } catch(error) {
    console.error('No se pudo leer la configuración pública desde Firebase', error);
    return {};
  }
}

const COLOR_MAP={blanco:'#f5f5f2',white:'#f5f5f2',marfil:'#eee9df',ivory:'#eee9df',beige:'#d8c6ad',arena:'#cbb99f',negro:'#222222',black:'#222222',oscuro:'#2c2c2c',gris:'#8a8a86',gray:'#8a8a86',grey:'#8a8a86',cafe:'#6f4b35','café':'#6f4b35',brown:'#6f4b35',camel:'#b58f70',cognac:'#9a5b32',chocolate:'#4a2f24',rojo:'#9e3f36',red:'#9e3f36',vino:'#6f2733',burgundy:'#6f2733',azul:'#45627a',blue:'#45627a',verde:'#5e7058',green:'#5e7058',olivo:'#72745a',olive:'#72745a',amarillo:'#d4b24f',yellow:'#d4b24f',naranja:'#c9773c',orange:'#c9773c',rosa:'#c98f9d',pink:'#c98f9d',morado:'#74607f',purple:'#74607f',dorado:'#b89a58',gold:'#b89a58',plateado:'#aaaeb0',silver:'#aaaeb0',natural:'#b89c7a'};
const colorItems=value=>{if(Array.isArray(value))return value.flatMap(colorItems);if(value&&typeof value==='object')return Object.values(value).flatMap(colorItems);const text=String(value??'').trim();if(!text||text==='—'||/^sin color$/i.test(text))return[];return text.split(/[,;|/\n]+/).map(v=>v.trim()).filter(Boolean)};
const colorHex=label=>{const value=String(label||'').trim();const hex=value.match(/#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})\b/i);if(hex)return hex[0];const normalized=value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();for(const[name,color]of Object.entries(COLOR_MAP)){const key=name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();if(normalized.includes(key))return color}return'#8a8178'};

function rgbToHex(r,g,b){return `#${[r,g,b].map(v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join('')}`}
function extractImageColor(src){
  return new Promise((resolve,reject)=>{
    if(!src)return reject(new Error('Imagen principal no disponible'));
    const image=new Image();
    image.crossOrigin='anonymous';
    image.decoding='async';
    image.onload=()=>{
      try{
        const size=48;
        const canvas=document.createElement('canvas');canvas.width=size;canvas.height=size;
        const context=canvas.getContext('2d',{willReadFrequently:true});
        context.drawImage(image,0,0,size,size);
        const data=context.getImageData(0,0,size,size).data;
        let r=0,g=0,b=0,count=0;
        for(let i=0;i<data.length;i+=16){
          const alpha=data[i+3];if(alpha<180)continue;
          const max=Math.max(data[i],data[i+1],data[i+2]);const min=Math.min(data[i],data[i+1],data[i+2]);
          if(max>244&&min>238)continue;
          if(max-min<8&&max>225)continue;
          r+=data[i];g+=data[i+1];b+=data[i+2];count++;
        }
        if(!count)throw new Error('No se encontró un color dominante');
        resolve(rgbToHex(r/count,g/count,b/count));
      }catch(error){reject(error)}
    };
    image.onerror=()=>reject(new Error('No se pudo analizar la imagen'));
    image.src=src;
  });
}

async function renderSwatches(product){
  const container=document.querySelector('[data-product-swatches]');if(!container)return;
  let extracted='';
  try{extracted=await extractImageColor(product.images?.[0])}catch(error){console.warn('Se usará el color de respaldo del catálogo',error)}
  const fallback=colorItems(product.color)[0];
  const color=extracted||colorHex(fallback||'natural');
  const label=extracted?'Color extraído de la imagen principal':(fallback||'Color del producto');
  container.innerHTML=`<button class="product-swatch is-active" type="button" aria-label="${esc(label)}" title="${esc(label)}" style="--swatch:${esc(color)}"></button>`;
}
function normalizePublicCategory(value){
  const text=String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  if(/decoracion/.test(text))return'decoracion';
  if(/iluminacion|lampara|candil|luminaria|lighting/.test(text))return'iluminacion';
  if(/exterior|outdoor|jardin|garden|terraza|patio|alberca|camastro/.test(text))return'exterior';
  if(/habitacion|recamara|dormitorio|\bcamas?\b|cabecera|mesa(?:s)?\s+de\s+noche|nightstand|buro/.test(text))return'habitacion';
  if(/interior|silla|mesa|sofa|ottoman|otomano|poltrona|sillon/.test(text))return'interior';
  return'';
}
function applyOverride(product,overrides){
  const lookupKeys=[product.id,product.code,product.slug].map(value=>String(value??'').trim().toLowerCase()).filter(Boolean);
  const o=lookupKeys.map(key=>overrides[key]).find(Boolean)||{};
  // Prefer the public/shop department saved by the panel. Legacy category
  // fields are used only when the dedicated field is absent.
  const overrideCategory=o.categoriaPublica||o.publicCategory||o.departamento||o.department||o.categoriaShop||o.shopCategory||o.categoria||o.category||'';
  const resolvedCategory=normalizePublicCategory(overrideCategory)||normalizePublicCategory(product.apiCategory)||product.category||'';
  return{...product,published:o.published===true,category:resolvedCategory,displayName:o.displayName||product.name,editorialDescription:o.editorialDescription||product.description,order:Number(o.order)||0,slug:o.slug||product.slug};
}

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
    const codeNode=document.querySelector('[data-product-code]');if(codeNode)codeNode.textContent=product.code;
    const set=(selector,value)=>{const n=document.querySelector(selector);if(n)n.textContent=value||'—'};
    set('[data-product-description]',product.editorialDescription);set('[data-product-materials]',product.materials);set('[data-product-measures]',product.measures);set('[data-product-breadcrumb-name]',product.displayName);
    const categoryLink=document.querySelector('[data-product-category-link]');if(categoryLink){categoryLink.textContent=categoryLabel(product.category);categoryLink.href=`productos.html?filter=${product.category||'todo'}`}
    const hasStock=Number(product.stock)>0;const priceNode=document.querySelector('[data-product-price]');const originalPriceNode=document.querySelector('[data-product-original-price]');const hasDiscount=Boolean(product.hasDiscount&&product.originalPrice!==null&&Number(product.price)<Number(product.originalPrice));if(priceNode){priceNode.textContent=hasStock?money(product.price):'Sin stock';priceNode.classList.toggle('is-discounted',hasStock&&hasDiscount)}if(originalPriceNode){originalPriceNode.textContent=hasDiscount?money(product.originalPrice):'';originalPriceNode.hidden=!hasStock||!hasDiscount}
    const priceBlock=document.querySelector('[data-product-price-block]');if(priceBlock){priceBlock.hidden=false;priceBlock.classList.add('is-visible')}
    const stockNode=document.querySelector('[data-product-stock]');if(stockNode){stockNode.textContent=hasStock?`${product.stock} disponibles`:'';stockNode.hidden=!hasStock}
    await renderSwatches(product);
    const gallery=document.querySelector('.product-gallery');if(gallery){const availableImages=Array.isArray(product.images)&&product.images.length?product.images.filter(Boolean):[catalog.FALLBACK_IMAGE];gallery.innerHTML=availableImages.map((src,index)=>`<figure class="product-gallery__item${index===0?' product-gallery__item--hero':''}"><img data-product-image="${index}" src="${esc(src)}" alt="${esc(product.displayName)} Casa Glick${index?`, vista ${index+1}`:''}" loading="${index===0?'eager':'lazy'}" onerror="this.onerror=null;this.src='${catalog.FALLBACK_IMAGE}'" /></figure>`).join('');gallery.removeAttribute('aria-busy');gallery.classList.remove('product-detail-skeleton');document.querySelector('.product-info')?.classList.remove('product-detail-skeleton');document.body.classList.add('product-detail-loaded');document.dispatchEvent(new CustomEvent('casa-glick:gallery-updated'))}
    const quote=document.querySelector('[data-product-quote]');if(quote){const hasPrice=product.price!==null&&Number.isFinite(Number(product.price));const canAdd=hasStock&&hasPrice;if(canAdd){quote.textContent='Agregar a bolsa';quote.href='bolsa.html';quote.removeAttribute('target');quote.removeAttribute('rel');quote.onclick=event=>{event.preventDefault();window.CasaGlickCart?.add({id:product.id,code:product.code,name:product.displayName,price:Number(product.price),image:(product.images&&product.images[0])||catalog.FALLBACK_IMAGE,stock:Number(product.stock)});quote.classList.add('is-added');quote.textContent='Agregado a bolsa';setTimeout(()=>{quote.classList.remove('is-added');quote.textContent='Agregar a bolsa'},1300)}}else{quote.textContent='Cotizar';quote.target='_blank';quote.rel='noopener';quote.onclick=null;const reason=!hasStock?'sin stock':'sin precio';quote.href=`https://wa.me/525513004665?text=${encodeURIComponent(`Hola, quiero cotizar ${product.displayName} (${product.code}) de Casa Glick. Actualmente aparece ${reason}.`)}`}}
  }catch(error){console.error('No se pudo cargar el producto',error);document.querySelectorAll('.product-detail-skeleton').forEach(node=>node.classList.remove('product-detail-skeleton'))}
}

renderListing();
renderDetail();
