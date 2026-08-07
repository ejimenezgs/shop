import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import { doc, getFirestore, onSnapshot, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

const firebaseConfig = window.CASA_GLICK_FIREBASE_CONFIG;
const schema = Array.isArray(window.CASA_GLICK_SHOP_SECTION_SCHEMA)
  ? window.CASA_GLICK_SHOP_SECTION_SCHEMA
  : [];

const specialMap = {
  hero: { root:'[data-section="hero"]', image:'[data-content="hero-image"] img', imageSource:'[data-content="hero-image"] source' },
  products: { root:'[data-section="products"]', title:'[data-content="products-title"]', description:['[data-content="products-description"]'], button:'[data-content="products-button"]' },
  showroom: { root:'[data-section="showroom"]', title:'[data-content="showroom-title"]', description:['[data-content="showroom-description"]'], button:'[data-content="showroom-button"]', image:'[data-content="showroom-image"]' },
  about: { root:'[data-section="about"]', title:'[data-content="about-title"]', description:['[data-content="about-description"]','[data-content="about-description-extra"]'], button:'[data-content="about-button"]', image:'[data-content="about-image"]' },
  brands: { root:'[data-section="brands"]', image:'[data-content="brands-image"]' },
  hospitality: { root:'[data-section="hospitality"]', title:'[data-content="hospitality-title"]', description:['[data-content="hospitality-description"]','[data-content="hospitality-description-extra"]'], button:'[data-content="hospitality-button"]', image:'[data-content="hospitality-image"]' },
  contact: { root:'[data-section="contact"]', eyebrow:'[data-content="contact-eyebrow"]', title:'[data-content="contact-title"]', button:'[data-content="contact-button"]', image:'[data-content="contact-image"]' }
};

const originals = new WeakMap();
const imageRequestVersions = new WeakMap();
function remember(element){
  if(!element || originals.has(element)) return;
  originals.set(element,{text:element.textContent,hidden:element.hidden,href:element.getAttribute?.('href'),src:element.getAttribute?.('src'),srcset:element.getAttribute?.('srcset')});
}
function trimmedString(value){ return typeof value==='string' ? value.trim() : ''; }
function normalizeShopWhatsappUrl(value){
  const url=trimmedString(value);
  return url.replace(/https:\/\/wa\.me\/(?:52)?5513004665(?=\?|$)/i,'https://wa.me/525514676585');
}
function isSafeLink(value){
  const url=trimmedString(value);
  if(!url || /^(javascript|data|file):/i.test(url)) return false;
  if(/^(https:\/\/|\/|\.\/|\.\.\/|#)/i.test(url)) return true;
  return /^(index|productos|producto|bolsa|checkout|confirmacion|checkout-success|checkout-cancel|cookie-policy|order)\.html(?:[?#].*)?$/i.test(url);
}
function isSafeImageUrl(value){
  const url=trimmedString(value);
  return Boolean(url && !/^(javascript|data|file):/i.test(url) && /^(https:\/\/|\/|\.\/|\.\.\/|assets\/)/i.test(url));
}
function setText(element,value){
  const text=trimmedString(value); if(!element || !text) return; remember(element);
  const childSpans=Array.from(element.children).filter(child=>child.tagName==='SPAN');
  if(!childSpans.length){ if(element.textContent!==text) element.textContent=text; return; }
  const parts=text.split(/\s*\|\s*|\n+/).map(part=>part.trim()).filter(Boolean);
  childSpans.forEach((span,index)=>{ span.textContent=parts[index]||''; span.hidden=!parts[index]; });
}
function setDescription(selectors,value){
  const text=trimmedString(value); if(!text) return;
  const elements=(Array.isArray(selectors)?selectors:[selectors]).flatMap(selector=>Array.from(document.querySelectorAll(selector))).filter(Boolean);
  if(!elements.length) return;
  const parts=text.split(/\n{2,}|\n/).map(part=>part.trim()).filter(Boolean);
  elements.forEach((element,index)=>{ remember(element); if(parts[index] || (index===0&&parts[0])){ element.textContent=parts[index]||parts[0]; element.hidden=false; } else element.hidden=true; });
}
function setButton(element,section){
  if(!element || !section) return;
  const text=trimmedString(section.buttonText), url=normalizeShopWhatsappUrl(section.buttonUrl);
  if(text){ remember(element); const target=element.querySelector('span:not([aria-hidden="true"])'); if(target)target.textContent=text; else element.textContent=text; }
  if(element.tagName==='A' && isSafeLink(url)){ remember(element); element.setAttribute('href',url); }
}
function setImage(image,source,value){
  const url=trimmedString(value);
  if(!image || !isSafeImageUrl(url)) return;

  remember(image);
  if(source) remember(source);

  const version=(imageRequestVersions.get(image)||0)+1;
  imageRequestVersions.set(image,version);

  // Aplicar inmediatamente la URL más reciente de Firebase. La versión evita
  // que una precarga anterior termine sobrescribiendo una actualización nueva.
  image.setAttribute('src',url);
  image.removeAttribute('srcset');
  if(source) source.setAttribute('srcset',url);

  const probe=new Image();
  probe.onload=()=>{
    if(imageRequestVersions.get(image)!==version) return;
    image.setAttribute('src',url);
    if(source) source.setAttribute('srcset',url);
  };
  probe.onerror=()=>{
    // No restaurar una imagen anterior: puede tratarse de una propagación o
    // caché temporal. El navegador volverá a solicitar la URL vigente.
    if(imageRequestVersions.get(image)!==version) return;
    console.warn('[Web Design] No se pudo precargar la imagen:',url);
  };
  probe.src=url;
}

function boolEnabled(value){ return !(value===false || value===0 || value==='false'); }
function applyProductsCategories(section){
  const map={interior:'categoryInteriorImageUrl',exterior:'categoryExteriorImageUrl',habitacion:'categoryHabitacionImageUrl',decoracion:'categoryDecoracionImageUrl'};
  Object.entries(map).forEach(([category,field])=>document.querySelectorAll(`[data-product-category-image="${category}"]`).forEach(img=>setImage(img,null,section[field])));
}
function applyGallery(section,type){
  const isLifestyle=type==='lifestyle';
  const selector=isLifestyle?'[data-lifestyle-slot]':'[data-showroom-slot]';
  const prefix=isLifestyle?'image':'galleryImage';
  document.querySelectorAll(selector).forEach(item=>{
    const slot=Number(item.dataset[isLifestyle?'lifestyleSlot':'showroomSlot']);
    const image=item.querySelector('img');
    const enabled=boolEnabled(section[`${prefix}${slot}Enabled`]);
    item.hidden=!enabled;
    item.style.setProperty('display',enabled?'':'none',enabled?'':'important');
    if(enabled) setImage(image,null,section[`${prefix}${slot}Url`]);
  });
}
function applyModal(section,prefix){
  setText(document.querySelector(`[data-content="${prefix}-modal-eyebrow"]`),section.modalEyebrow);
  setText(document.querySelector(`[data-content="${prefix}-modal-title"]`),section.modalTitle);
  setDescription(`[data-content="${prefix}-modal-description"]`,section.modalDescription);
  const button=document.querySelector(`[data-content="${prefix}-modal-button"]`);
  if(button) setButton(button,{buttonText:section.modalButtonText,buttonUrl:section.modalButtonUrl});
  for(let i=1;i<=4;i++){
    setText(document.querySelector(`[data-content="${prefix}-modal-item-${i}-title"]`),section[`modalItem${i}Title`]);
    setDescription(`[data-content="${prefix}-modal-item-${i}-description"]`,section[`modalItem${i}Description`]);
  }
}

function dynamicMapFor(name){
  const prefix=`${name}-`;
  return {
    root:`[data-section="${CSS.escape(name)}"]`,
    eyebrow:`[data-content="${CSS.escape(prefix+'eyebrow')}"]`,
    title:`[data-content="${CSS.escape(prefix+'title')}"]`,
    description:[`[data-content="${CSS.escape(prefix+'description')}"]`,`[data-content^="${CSS.escape(prefix+'description-')}"]`],
    button:`[data-content="${CSS.escape(prefix+'button')}"]`,
    image:`[data-content="${CSS.escape(prefix+'image')}"]`
  };
}
function applySection(name,section){
  if(!section || typeof section!=='object') return;
  const map={...dynamicMapFor(name),...(specialMap[name]||{})};
  const root=document.querySelector(map.root) || document.querySelector(`[data-section="${CSS.escape(name)}"]`);
  if(!root) return;
  remember(root);
  const disabled=section.enabled===false || section.enabled===0 || section.enabled==='false';
  if(disabled){ root.hidden=true; root.classList.add('is-shop-content-disabled'); root.style.setProperty('display','none','important'); root.setAttribute('aria-hidden','true'); }
  else { root.hidden=false; root.classList.remove('is-shop-content-disabled'); root.style.removeProperty('display'); root.removeAttribute('aria-hidden'); }
  if(map.eyebrow) setText(document.querySelector(map.eyebrow),section.eyebrow);
  if(map.title) setText(document.querySelector(map.title),section.title);
  if(map.description) setDescription(map.description,section.description);
  if(map.button) setButton(document.querySelector(map.button),section);
  if(name==='products') applyProductsCategories(section);
  if(name==='brands') applyGallery(section,'lifestyle');
  if(name==='showroom') applyGallery(section,'showroom');
  if(name==='about') applyModal(section,'about');
  if(name==='hospitality') applyModal(section,'hospitality');
  if(map.image){
    let image=document.querySelector(map.image), source=map.imageSource?document.querySelector(map.imageSource):null;
    if(image?.tagName==='PICTURE'){ source=image.querySelector('source'); image=image.querySelector('img'); }
    setImage(image,source,section.imageUrl);
  }
}
function normalizedOrder(order){
  const domKeys=Array.from(document.querySelectorAll('main > [data-section]')).map(node=>node.dataset.section).filter(Boolean);
  const definitions=schema.length?schema:domKeys.map(key=>({key}));
  const first=definitions.filter(def=>def.lockedPosition==='first').map(def=>def.key);
  const last=definitions.filter(def=>def.lockedPosition==='last').map(def=>def.key);
  const all=[...new Set([...definitions.map(def=>def.key),...domKeys])];
  const movable=all.filter(key=>!first.includes(key)&&!last.includes(key));
  const requested=Array.isArray(order)?order.filter(key=>movable.includes(key)):[];
  return [...first,...requested,...movable.filter(key=>!requested.includes(key)),...last];
}
function applySectionOrder(order){
  const main=document.querySelector('main'); if(!main)return;
  const nodes=new Map(Array.from(main.querySelectorAll(':scope > [data-section]')).map(node=>[node.dataset.section,node]));
  normalizedOrder(order).forEach(key=>{ const node=nodes.get(key); if(node)main.appendChild(node); });
}
function applyShopContent(content){
  if(!content || typeof content!=='object') return;
  applySectionOrder(content.sectionOrder);
  const nested=content.sections&&typeof content.sections==='object'?content.sections:{};
  const keys=new Set([...schema.map(def=>def.key),...Object.keys(nested),...Object.keys(specialMap)]);
  keys.forEach(name=>{
    const direct=content[name]&&typeof content[name]==='object'?content[name]:{};
    const section=nested[name]&&typeof nested[name]==='object'?nested[name]:{};
    // sections.<seccion> es la fuente canonica. La copia superior solo se usa
    // como fallback para documentos antiguos y nunca puede reemplazar una URL
    // absoluta mas nueva guardada por el Panel.
    applySection(name,{...direct,...section});
  });
}
async function startShopContent(){
  if(!firebaseConfig?.projectId){ console.error('[Web Design] No se encontró la configuración de Firebase.'); return; }
  try{
    const app=getApps().length?getApps()[0]:initializeApp(firebaseConfig);
    const db=getFirestore(app), contentRef=doc(db,'shopContent','home');
    const initial=await getDoc(contentRef); if(initial.exists())applyShopContent(initial.data());
    onSnapshot(contentRef,snapshot=>{ if(snapshot.exists())applyShopContent(snapshot.data()); },error=>console.error('[Web Design] Listener:',error));
  }catch(error){ console.error('[Web Design] No se pudo iniciar:',error); }
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',startShopContent,{once:true}); else startShopContent();
