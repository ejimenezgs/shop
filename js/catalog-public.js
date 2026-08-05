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

function normalizeLookupKey(value){
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'')
    .toLowerCase()
    .replace(/[^a-z0-9]/g,'');
}

function collectIdentityValues(source){
  if(!source || typeof source!=='object')return[];
  const keys=[
    'code','codigo','sku','productId','productID','idProducto','inventoryId','inventoryID',
    'codigoProducto','productCode','clave','claveProducto','itemCode','itemId','itemID','slug'
  ];
  const values=[];
  for(const key of keys){
    const value=source[key];
    if(Array.isArray(value)) values.push(...value);
    else if(value!==undefined&&value!==null) values.push(value);
  }
  return values;
}

async function readOverrides(){
  if (!config.projectId) return {exact:{},canonical:{},records:[]};
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
    const exact={};
    const canonical={};
    const records=[];
    const addKey=(key,value)=>{
      const clean=String(key??'').trim().toLowerCase();
      if(clean)exact[clean]=value;
      const normalized=normalizeLookupKey(key);
      if(normalized)canonical[normalized]=value;
    };
    snapshot.forEach(item=>{
      const data={...item.data(),__documentId:item.id};
      records.push(data);
      addKey(item.id,data);
      collectIdentityValues(data).forEach(value=>addKey(value,data));
    });
    return{exact,canonical,records};
  }catch(error){
    console.error('No se pudo leer la configuración pública desde Firebase',error);
    return{exact:{},canonical:{},records:[]};
  }
}



async function readInventoryReservations(){
  if(!config.projectId)return{};
  try{
    const [{initializeApp,getApps},{collection,getDocs,getFirestore}]=await withTimeout(
      Promise.all([
        import('https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js'),
        import('https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js')
      ]),7000,'Firebase tardó demasiado en cargar'
    );
    const app=getApps().length?getApps()[0]:initializeApp(config);
    const snapshot=await withTimeout(
      getDocs(collection(getFirestore(app),'inventoryStockReservations')),
      7000,'Firestore tardó demasiado en responder'
    );
    const result={};
    snapshot.forEach(item=>{
      const data=item.data()||{};
      const sku=String(data.sku||item.id||'').trim();
      if(!sku)return;
      result[normalizeLookupKey(sku)]=Math.max(0,Number(data.reservedQuantity)||0);
    });
    return result;
  }catch(error){
    console.error('No se pudieron leer los apartados de inventario',error);
    return{};
  }
}

const COLOR_MAP={blanco:'#f5f5f2',white:'#f5f5f2',marfil:'#eee9df',ivory:'#eee9df',beige:'#d8c6ad',arena:'#cbb99f',negro:'#222222',black:'#222222',oscuro:'#2c2c2c',gris:'#8a8a86',gray:'#8a8a86',grey:'#8a8a86',cafe:'#6f4b35','café':'#6f4b35',brown:'#6f4b35',camel:'#b58f70',cognac:'#9a5b32',chocolate:'#4a2f24',rojo:'#9e3f36',red:'#9e3f36',vino:'#6f2733',burgundy:'#6f2733',azul:'#45627a',blue:'#45627a',verde:'#5e7058',green:'#5e7058',olivo:'#72745a',olive:'#72745a',amarillo:'#d4b24f',yellow:'#d4b24f',naranja:'#c9773c',orange:'#c9773c',rosa:'#c98f9d',pink:'#c98f9d',morado:'#74607f',purple:'#74607f',dorado:'#b89a58',gold:'#b89a58',plateado:'#aaaeb0',silver:'#aaaeb0',natural:'#b89c7a'};
const colorItems=value=>{if(Array.isArray(value))return value.flatMap(colorItems);if(value&&typeof value==='object')return Object.values(value).flatMap(colorItems);const text=String(value??'').trim();if(!text||text==='—'||/^sin color$/i.test(text))return[];return text.split(/[,;|/\n]+/).map(v=>v.trim()).filter(Boolean)};
const colorHex=label=>{const value=String(label||'').trim();const hex=value.match(/#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})\b/i);if(hex)return hex[0];const normalized=value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();for(const[name,color]of Object.entries(COLOR_MAP)){const key=name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();if(normalized.includes(key))return color}return'#8a8178'};

function renderSwatches(product){
  const container=document.querySelector('[data-product-swatches]');
  if(!container)return;
  const colors=colorItems(product.color);
  const values=colors.length?colors:['Natural'];
  container.innerHTML=values.map((label,index)=>`<button class="product-swatch${index===0?' is-active':''}" type="button" aria-label="${esc(label)}" style="--swatch:${esc(colorHex(label))}"></button>`).join('');
}
function publicCategoryText(value){
  if(value===null||value===undefined)return'';
  if(Array.isArray(value))return value.map(publicCategoryText).filter(Boolean).join(' ');
  if(value&&typeof value==='object'){
    const preferred=['nombre','name','label','value','titulo','title','seccion','section','categoria','category'];
    for(const key of preferred){if(value[key]!==undefined){const text=publicCategoryText(value[key]);if(text)return text}}
    return Object.values(value).map(publicCategoryText).filter(Boolean).join(' ');
  }
  return String(value).trim();
}
function normalizePublicCategory(value){
  const text=publicCategoryText(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  if(/decoracion/.test(text))return'decoracion';
  if(/iluminacion|lampara|candil|luminaria|lighting/.test(text))return'iluminacion';
  if(/exterior|outdoor|jardin|garden|terraza|patio|alberca|camastro/.test(text))return'exterior';
  if(/habitacion|recamara|dormitorio|\bcamas?\b|cabecera|mesa(?:s)?\s+de\s+noche|nightstand|buro/.test(text))return'habitacion';
  if(/interior|silla|mesa|sofa|ottoman|otomano|poltrona|sillon/.test(text))return'interior';
  return'';
}
function findOverride(product,overrides){
  const values=[product.id,product.code,product.slug,...collectIdentityValues(product)].filter(v=>v!==undefined&&v!==null&&String(v).trim());
  for(const value of values){
    const exact=overrides.exact[String(value).trim().toLowerCase()];
    if(exact)return exact;
  }
  for(const value of values){
    const canonical=overrides.canonical[normalizeLookupKey(value)];
    if(canonical)return canonical;
  }
  // Last safe fallback: compare normalized identifiers from every panel record.
  const productKeys=new Set(values.map(normalizeLookupKey).filter(Boolean));
  return overrides.records.find(record=>collectIdentityValues(record).some(value=>productKeys.has(normalizeLookupKey(value))))||{};
}
function normalizeFieldKey(value){
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'')
    .toLowerCase()
    .replace(/[^a-z0-9]/g,'');
}

function readPanelWebCategory(record){
  if(!record || typeof record !== 'object') return '';

  // "Categoría Web" is the label shown by the panel. Depending on the
  // panel build, Firestore may store it with one of these internal keys.
  const preferredKeys = new Set([
    'categoriaweb','webcategory','categoryweb','categoriatienda','shopcategory',
    'seccionweb','websection','sectionweb','departamentoweb','webdepartment'
  ]);
  const panelFallbackKeys = new Set([
    'categoria','category','seccion','section','departamento','department'
  ]);

  let panelFallback = '';
  const visit = (value, depth = 0) => {
    if(!value || typeof value !== 'object' || depth > 4) return '';
    for(const [key, child] of Object.entries(value)){
      const normalizedKey = normalizeFieldKey(key);
      if(preferredKeys.has(normalizedKey)){
        const normalizedValue = normalizePublicCategory(child);
        if(normalizedValue) return normalizedValue;
      }
      if(!panelFallback && panelFallbackKeys.has(normalizedKey)){
        const normalizedValue = normalizePublicCategory(child);
        if(normalizedValue) panelFallback = normalizedValue;
      }
    }
    for(const child of Object.values(value)){
      if(child && typeof child === 'object'){
        const result = visit(child, depth + 1);
        if(result) return result;
      }
    }
    return '';
  };

  return visit(record) || panelFallback;
}

function mapPanelCategoryToShop(value){
  const category=String(value??'')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'')
    .toLowerCase()
    .trim();

  if(['sillas','mesas','sofas','poltronas','ottoman','ottomanos','interior'].includes(category))return'interior';
  if(category==='exterior')return'exterior';
  if(category==='habitacion')return'habitacion';
  if(category==='decoracion')return'decoracion';
  if(category==='iluminacion')return'iluminacion';
  return'';
}

function applyOverride(product,overrides){
  const o=findOverride(product,overrides);
  const panelCategory=String(o.category??'').trim();
  const shopCategory=mapPanelCategoryToShop(panelCategory);

  // The panel now persists the normalized inventory category in Firestore.
  // Use that saved value as the single source of truth for public sections.
  return{
    ...product,
    published:o.published===true,
    category:shopCategory,
    panelCategory,
    categoryLabel:o.categoryLabel||'',
    apiCategory:o.apiCategory||'',
    displayName:o.displayName||product.name,
    editorialDescription:o.editorialDescription||product.description,
    order:Number(o.order)||0,
    slug:o.slug||product.slug
  };
}

async function loadPublicProducts() {
  if (!catalog) throw new Error('CasaGlickCatalog no está disponible');
  const [productsResult, overridesResult, reservationsResult] = await Promise.allSettled([
    withTimeout(catalog.fetchProducts(), 12000, 'La API del inventario tardó demasiado en responder'),
    readOverrides(),
    readInventoryReservations()
  ]);
  if (productsResult.status === 'rejected') throw productsResult.reason;
  const overrides = overridesResult.status === 'fulfilled' ? overridesResult.value : {};
  const reservations = reservationsResult.status === 'fulfilled' ? reservationsResult.value : {};
  return productsResult.value.map(product => {
    const configured=applyOverride(product,overrides);
    const reserved=Math.max(0,Number(reservations[normalizeLookupKey(configured.code)])||0);
    const physical=Math.max(0,Number(configured.stock)||0);
    return{
      ...configured,
      physicalStock:physical,
      reservedStock:reserved,
      stock:Math.max(0,physical-reserved)
    };
  });
}

const LISTING_BATCH_SIZE = 12;


const SUBCATEGORY_META = {
  todo: { label: 'Todos los productos', parent: 'todo' },
  sillas: { label: 'Sillas', parent: 'interior' },
  mesas: { label: 'Mesas', parent: 'interior' },
  mesas_auxiliares: { label: 'Mesas auxiliares', parent: 'interior' },
  mesas_centro: { label: 'Mesas de centro', parent: 'interior' },
  mesas_comedor: { label: 'Mesas de comedor', parent: 'interior' },
  sofas: { label: 'Sofás', parent: 'interior' },
  sofas_individuales: { label: 'Sofás individuales', parent: 'interior' },
  ottomanos: { label: 'Ottomanos', parent: 'interior' },
  camastros: { label: 'Camastros', parent: 'exterior' },
  sillas_exterior: { label: 'Sillas de exterior', parent: 'exterior' },
  mesas_exterior: { label: 'Mesas de exterior', parent: 'exterior' },
  salas_exterior: { label: 'Salas de exterior', parent: 'exterior' },
  camas: { label: 'Camas', parent: 'habitacion' },
  cabeceras: { label: 'Cabeceras', parent: 'habitacion' },
  mesas_noche: { label: 'Mesas de noche', parent: 'habitacion' },
  espejos: { label: 'Espejos', parent: 'decoracion' },
  cuadros: { label: 'Cuadros', parent: 'decoracion' },
  floreros: { label: 'Floreros', parent: 'decoracion' },
  accesorios: { label: 'Accesorios', parent: 'decoracion' },
  consolas: { label: 'Consolas', parent: 'decoracion' },
  lamparas_colgantes: { label: 'Lámparas colgantes', parent: 'iluminacion' },
  lamparas_mesa: { label: 'Lámparas de mesa', parent: 'iluminacion' },
  lamparas_piso: { label: 'Lámparas de piso', parent: 'iluminacion' },
  candiles: { label: 'Candiles', parent: 'iluminacion' },
  iluminacion: { label: 'Iluminación', parent: 'iluminacion' }
};

function normalizeSubcategoryText(value){
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
}

function productSubcategory(product){
  const text=normalizeSubcategoryText([product.apiCategory,product.panelCategory,product.name].filter(Boolean).join(' '));
  const parent=normalizeListingFilter(product.category);

  if(parent==='interior'){
    if(/mesa(?:s)?\s+(?:auxiliar|lateral)|side\s*table/.test(text))return'mesas_auxiliares';
    if(/mesa(?:s)?\s+de\s+centro|coffee\s*table/.test(text))return'mesas_centro';
    if(/mesa(?:s)?\s+de\s+comedor|dining\s*table/.test(text))return'mesas_comedor';
    if(/poltrona|sillon(?:es)?\s+individual|sofa(?:s)?\s+individual|butaca/.test(text))return'sofas_individuales';
    if(/ottoman|otomano|pouf|puf|reposapies/.test(text))return'ottomanos';
    if(/silla|banco|taburete|stool/.test(text))return'sillas';
    if(/sofa|seccional|love\s*seat/.test(text))return'sofas';
    if(/mesa|consola|escritorio/.test(text))return'mesas';
  }
  if(parent==='exterior'){
    if(/camastro|tumbona|sun\s*lounger|chaise/.test(text))return'camastros';
    if(/silla|banco|taburete/.test(text))return'sillas_exterior';
    if(/mesa/.test(text))return'mesas_exterior';
    if(/sofa|sala|seccional/.test(text))return'salas_exterior';
  }
  if(parent==='habitacion'){
    if(/mesa(?:s)?\s+de\s+noche|nightstand|buro/.test(text))return'mesas_noche';
    if(/cabecera/.test(text))return'cabeceras';
    if(/cama/.test(text))return'camas';
  }
  if(parent==='decoracion'){
    if(/espejo/.test(text))return'espejos';
    if(/cuadro|arte|wall\s*art/.test(text))return'cuadros';
    if(/florero|jarron|vaso decorativo/.test(text))return'floreros';
    if(/consola/.test(text))return'consolas';
    return'accesorios';
  }
  if(parent==='iluminacion'){
    if(/colgante|pendant/.test(text))return'lamparas_colgantes';
    if(/mesa|table\s*lamp/.test(text))return'lamparas_mesa';
    if(/piso|floor\s*lamp/.test(text))return'lamparas_piso';
    if(/candil|chandelier/.test(text))return'candiles';
    return'iluminacion';
  }
  return'';
}

function subcategoryLabel(value){
  return SUBCATEGORY_META[value]?.label || value || 'Todos los productos';
}

function listingCardMarkup(product){
  return `<article class="product-card product-card--progressive" data-category="${esc(product.category||'todo')}" data-subcategory="${esc(product.subcategory||'')}" data-brand="${esc(product.brand)}"><a class="product-card__link" href="producto.html?product=${encodeURIComponent(product.code)}" aria-label="Ver detalle de ${esc(product.displayName)}"><img src="${esc(product.images[0])}" alt="${esc(product.displayName)} Casa Glick" loading="lazy" onerror="this.onerror=null;this.src='${catalog.FALLBACK_IMAGE}'" /><span class="seo-image-caption">${esc(product.displayName)} de Casa Glick</span><span class="product-card__meta"><strong>${esc(product.displayName)}</strong><small>${esc(categoryLabel(product.category))}</small></span></a></article>`;
}

function normalizeListingFilter(value){
  const clean=String(value||'todo').toLowerCase().trim();
  if(clean==='all')return 'todo';
  if(clean==='decoración')return 'decoracion';
  if(clean==='iluminación')return 'iluminacion';
  if(clean==='habitación')return 'habitacion';
  return clean;
}


function setupPremiumMobilePicker(root,onSelect){
  if(!root||root.dataset.premiumPickerReady==='true')return;
  const select=root.querySelector('select');
  const button=root.querySelector('.catalog-premium-picker__button');
  const value=root.querySelector('.catalog-premium-picker__value');
  const menu=root.querySelector('.catalog-premium-picker__menu');
  if(!select||!button||!value||!menu)return;

  const close=()=>{root.classList.remove('is-open');button.setAttribute('aria-expanded','false');};
  const sync=()=>{
    const options=Array.from(select.options);
    const selected=options.find(option=>option.value===select.value)||options[0];
    value.textContent=selected?.textContent?.trim()||'';
    menu.innerHTML=options.map(option=>`<button class="catalog-premium-picker__option${option.value===select.value?' is-selected':''}" type="button" role="option" aria-selected="${option.value===select.value?'true':'false'}" data-picker-value="${esc(option.value)}">${esc(option.textContent.trim())}</button>`).join('');
  };

  button.addEventListener('click',event=>{
    event.stopPropagation();
    const open=!root.classList.contains('is-open');
    document.querySelectorAll('.catalog-premium-picker.is-open').forEach(item=>{if(item!==root){item.classList.remove('is-open');item.querySelector('.catalog-premium-picker__button')?.setAttribute('aria-expanded','false');}});
    root.classList.toggle('is-open',open);
    button.setAttribute('aria-expanded',open?'true':'false');
  });
  menu.addEventListener('click',event=>{
    const option=event.target.closest('[data-picker-value]');
    if(!option)return;
    select.value=option.dataset.pickerValue;
    sync();
    close();
    onSelect?.(select.value);
  });
  document.addEventListener('click',event=>{if(!root.contains(event.target))close();});
  select.addEventListener('change',sync);
  root._syncPremiumPicker=sync;
  root.dataset.premiumPickerReady='true';
  sync();
}


function setupHierarchicalMobilePicker(root,options){
  if(!root||root.dataset.hierarchicalPickerReady==='true')return;
  const button=root.querySelector('.catalog-hierarchical-picker__button');
  const value=root.querySelector('.catalog-hierarchical-picker__value');
  const menu=root.querySelector('.catalog-hierarchical-picker__menu');
  if(!button||!value||!menu)return;

  const categoryLabels={
    todo:'Todo',interior:'Interior',exterior:'Exterior',habitacion:'Habitación',decoracion:'Decoración',iluminacion:'Iluminación'
  };
  const categories=['todo','interior','exterior','habitacion','decoracion','iluminacion'];
  const submenuParents=new Set(['interior','exterior','habitacion','decoracion']);
  let level='root';

  const close=()=>{
    root.classList.remove('is-open');
    button.setAttribute('aria-expanded','false');
    level='root';
  };

  const renderRoot=()=>{
    level='root';
    const state=options.getState();
    menu.innerHTML=categories.map(category=>{
      const hasChildren=submenuParents.has(category)&&options.getSubcategories(category).length>0;
      const selected=state.filter===category&&!state.subcategory;
      return `<button class="catalog-hierarchical-picker__option${selected?' is-selected':''}" type="button" role="menuitem" data-hier-category="${esc(category)}"><span>${esc(categoryLabels[category])}</span>${hasChildren?'<i aria-hidden="true"></i>':''}</button>`;
    }).join('');
  };

  const renderSubmenu=parent=>{
    level=parent;
    const state=options.getState();
    const keys=options.getSubcategories(parent);
    menu.innerHTML=`<button class="catalog-hierarchical-picker__back" type="button" role="menuitem" data-hier-back><span aria-hidden="true">←</span>${esc(categoryLabels[parent])}</button>`+
      `<button class="catalog-hierarchical-picker__option${state.filter===parent&&!state.subcategory?' is-selected':''}" type="button" role="menuitem" data-hier-parent="${esc(parent)}" data-hier-subcategory=""><span>Todo</span></button>`+
      keys.map(key=>`<button class="catalog-hierarchical-picker__option${state.filter===parent&&state.subcategory===key?' is-selected':''}" type="button" role="menuitem" data-hier-parent="${esc(parent)}" data-hier-subcategory="${esc(key)}"><span>${esc(subcategoryLabel(key))}</span></button>`).join('');
  };

  const sync=()=>{
    const state=options.getState();
    value.textContent=state.filter==='todo'
      ? 'Todo'
      : state.subcategory
        ? `${categoryLabels[state.filter]} · ${subcategoryLabel(state.subcategory)}`
        : categoryLabels[state.filter]||'Todo';
    if(root.classList.contains('is-open')){
      if(level==='root')renderRoot();else renderSubmenu(level);
    }
  };

  button.addEventListener('click',event=>{
    event.stopPropagation();
    const open=!root.classList.contains('is-open');
    root.classList.toggle('is-open',open);
    button.setAttribute('aria-expanded',open?'true':'false');
    if(open)renderRoot();
  });

  menu.addEventListener('pointerdown',event=>{
    // Keep taps inside the open menu from reaching outside-click handlers.
    event.stopPropagation();
  });

  menu.addEventListener('click',event=>{
    event.preventDefault();
    event.stopPropagation();

    const back=event.target.closest('[data-hier-back]');
    if(back){
      renderRoot();
      root.classList.add('is-open');
      button.setAttribute('aria-expanded','true');
      return;
    }

    const categoryButton=event.target.closest('[data-hier-category]');
    if(categoryButton){
      const category=categoryButton.dataset.hierCategory;
      const keys=submenuParents.has(category)?options.getSubcategories(category):[];

      // Categories with children only open the second level. They do not
      // apply a filter or close the picker until the user chooses an option.
      if(keys.length){
        renderSubmenu(category);
        root.classList.add('is-open');
        button.setAttribute('aria-expanded','true');
        requestAnimationFrame(()=>menu.scrollTo({top:0,behavior:'auto'}));
        return;
      }

      options.onSelect(category,'');
      close();
      return;
    }

    const subButton=event.target.closest('[data-hier-parent]');
    if(subButton){
      options.onSelect(subButton.dataset.hierParent,subButton.dataset.hierSubcategory||'');
      close();
    }
  });

  document.addEventListener('pointerdown',event=>{if(!root.contains(event.target))close();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&root.classList.contains('is-open')){close();button.focus();}});
  root._syncHierarchicalPicker=sync;
  root.dataset.hierarchicalPickerReady='true';
  sync();
}

async function renderListing(){
  const list=document.querySelector('.products-list');
  if(!list)return;
  list.setAttribute('aria-busy','true');
  try{
    const products=(await loadPublicProducts())
      .filter(product=>product.published)
      .map(product=>({...product,subcategory:productSubcategory(product)}))
      .sort((a,b)=>a.order-b.order||a.displayName.localeCompare(b.displayName,'es'));

    const params=new URLSearchParams(location.search);
    let activeFilter=normalizeListingFilter(params.get('filter')||'todo');
    let activeSubcategory=String(params.get('subcat')||'').trim();
    const SUBCATEGORY_PARENTS=new Set(['interior','exterior','habitacion','decoracion']);
    let filteredProducts=[];
    let renderedCount=0;
    let sentinel=document.querySelector('[data-products-load-more]');

    if(!sentinel){
      sentinel=document.createElement('div');
      sentinel.className='products-load-more';
      sentinel.setAttribute('data-products-load-more','');
      sentinel.setAttribute('aria-hidden','true');
      list.insertAdjacentElement('afterend',sentinel);
    }

    const availableSubcategories=parent=>{
      const keys=[...new Set(products.filter(p=>p.category===parent&&p.subcategory).map(p=>p.subcategory))];
      return keys.sort((a,b)=>subcategoryLabel(a).localeCompare(subcategoryLabel(b),'es'));
    };

    const updateEmptyState=()=>{
      const empty=document.querySelector('[data-products-filter-empty]');
      if(empty)empty.hidden=filteredProducts.length>0;
    };

    const appendBatch=()=>{
      if(renderedCount>=filteredProducts.length){sentinel.hidden=true;return;}
      const next=filteredProducts.slice(renderedCount,renderedCount+LISTING_BATCH_SIZE);
      list.insertAdjacentHTML('beforeend',next.map(listingCardMarkup).join(''));
      renderedCount+=next.length;
      sentinel.hidden=renderedCount>=filteredProducts.length;
      requestAnimationFrame(()=>list.querySelectorAll('.product-card--progressive:not(.is-visible)').forEach(card=>card.classList.add('is-visible')));
    };

    const renderDesktopFlyouts=()=>{
      document.querySelectorAll('[data-subcategory-flyout]').forEach(flyout=>{
        const parent=flyout.dataset.subcategoryFlyout;
        const keys=availableSubcategories(parent);
        flyout.innerHTML=`<button type="button" data-sub-filter="" data-parent-filter="${esc(parent)}">Todo</button>${keys.map(key=>`<button type="button" data-sub-filter="${esc(key)}" data-parent-filter="${esc(parent)}">${esc(subcategoryLabel(key))}</button>`).join('')}`;
        flyout.closest('.products-filter__group')?.classList.toggle('has-no-subcategories',keys.length===0);
      });
    };

    const syncMobileHierarchicalPicker=()=>{
      document.querySelector('[data-mobile-hierarchical-picker]')?._syncHierarchicalPicker?.();
    };

    const updateControls=()=>{
      document.querySelectorAll('[data-main-filter]').forEach(btn=>{
        const active=btn.dataset.mainFilter===activeFilter;
        btn.classList.toggle('is-active',active);
        btn.setAttribute('aria-expanded',active&&btn.closest('.products-filter__group')?.matches(':hover')?'true':'false');
      });
      document.querySelectorAll('[data-sub-filter]').forEach(btn=>btn.classList.toggle('is-active',btn.dataset.parentFilter===activeFilter&&btn.dataset.subFilter===activeSubcategory));
      syncMobileHierarchicalPicker();
    };

    const resetListing=(filter,subcategory='',updateUrl=true)=>{
      activeFilter=normalizeListingFilter(filter);
      activeSubcategory=SUBCATEGORY_PARENTS.has(activeFilter)?String(subcategory||''):'';
      const validSubs=SUBCATEGORY_PARENTS.has(activeFilter)?availableSubcategories(activeFilter):[];
      if(activeSubcategory&&!validSubs.includes(activeSubcategory))activeSubcategory='';
      filteredProducts=products.filter(product=>{
        const parentMatches=activeFilter==='todo'||product.category===activeFilter;
        const subMatches=!activeSubcategory||product.subcategory===activeSubcategory;
        return parentMatches&&subMatches;
      });
      renderedCount=0;
      list.innerHTML='';
      updateEmptyState();
      appendBatch();
      updateControls();
      if(updateUrl){
        const url=new URL(location.href);
        url.searchParams.set('filter',activeFilter);
        if(activeSubcategory)url.searchParams.set('subcat',activeSubcategory);else url.searchParams.delete('subcat');
        history.replaceState({},'',url);
      }
    };

    renderDesktopFlyouts();

    document.querySelectorAll('[data-main-filter]').forEach(button=>{
      button.addEventListener('click',()=>resetListing(button.dataset.mainFilter,''));
    });
    document.addEventListener('click',event=>{
      const sub=event.target.closest('[data-sub-filter]');
      if(sub)resetListing(sub.dataset.parentFilter,sub.dataset.subFilter);
    });

    document.querySelectorAll('.products-filter__group').forEach(group=>{
      const trigger=group.querySelector('[data-main-filter]');
      const open=()=>{
        group.classList.add('is-flyout-open');
        trigger?.setAttribute('aria-expanded','true');
      };
      const closeGroup=()=>{
        group.classList.remove('is-flyout-open');
        trigger?.setAttribute('aria-expanded','false');
      };
      group.addEventListener('mouseenter',open);
      group.addEventListener('mouseleave',closeGroup);
      group.addEventListener('focusin',open);
      group.addEventListener('focusout',event=>{if(!group.contains(event.relatedTarget))closeGroup();});
    });

    const hierarchicalPicker=document.querySelector('[data-mobile-hierarchical-picker]');
    setupHierarchicalMobilePicker(hierarchicalPicker,{
      getState:()=>({filter:activeFilter,subcategory:activeSubcategory}),
      getSubcategories:availableSubcategories,
      onSelect:(filter,subcategory)=>resetListing(filter,subcategory)
    });

    // Progressive rendering with two independent triggers. IntersectionObserver
    // remains the primary mechanism, while the scroll/resize fallback prevents
    // the catalog from stopping after the first batch in browsers or layouts
    // where the 1px sentinel is not reported reliably.
    const loadMoreIfNeeded=()=>{
      if(renderedCount>=filteredProducts.length)return;
      const threshold=window.innerHeight+900;
      let safety=0;
      while(renderedCount<filteredProducts.length&&sentinel.getBoundingClientRect().top<=threshold&&safety<20){
        appendBatch();
        safety+=1;
      }
    };

    let observer=null;
    if('IntersectionObserver' in window){
      observer=new IntersectionObserver(entries=>{
        if(entries.some(entry=>entry.isIntersecting)){
          appendBatch();
          requestAnimationFrame(loadMoreIfNeeded);
        }
      },{rootMargin:'900px 0px'});
      observer.observe(sentinel);
    }

    let progressiveTicking=false;
    const scheduleProgressiveLoad=()=>{
      if(progressiveTicking)return;
      progressiveTicking=true;
      requestAnimationFrame(()=>{
        progressiveTicking=false;
        loadMoreIfNeeded();
      });
    };
    window.addEventListener('scroll',scheduleProgressiveLoad,{passive:true});
    window.addEventListener('resize',scheduleProgressiveLoad,{passive:true});

    window.addEventListener('popstate',()=>{
      const next=new URLSearchParams(location.search);
      resetListing(next.get('filter')||'todo',next.get('subcat')||'',false);
    });

    resetListing(activeFilter,activeSubcategory,false);
    requestAnimationFrame(loadMoreIfNeeded);
  }catch(error){
    console.error('No se pudo cargar el catálogo público',error);
    list.innerHTML='<p class="products-empty">No fue posible cargar los productos. Recarga la página para intentarlo nuevamente.</p>';
  }finally{
    list.removeAttribute('aria-busy');
  }
}

function fitProductTitleToTwoLines(node){
  if(!node)return;

  node.classList.add('is-fitting-title');
  node.style.fontSize='';
  node.style.lineHeight='';
  node.style.maxHeight='none';

  const mobile=window.matchMedia('(max-width: 820px)').matches;
  const computed=getComputedStyle(node);
  const startSize=parseFloat(computed.fontSize)||64;
  const minimumSize=mobile?22:26;
  const lineHeightRatio=0.98;

  const countRenderedLines=()=>{
    const range=document.createRange();
    range.selectNodeContents(node);
    const rects=Array.from(range.getClientRects()).filter(rect=>rect.width>0&&rect.height>0);
    range.detach?.();
    const tops=[];
    rects.forEach(rect=>{
      if(!tops.some(top=>Math.abs(top-rect.top)<2))tops.push(rect.top);
    });
    return Math.max(1,tops.length);
  };

  const applySize=size=>{
    node.style.fontSize=`${size}px`;
    node.style.lineHeight=String(lineHeightRatio);
    return countRenderedLines();
  };

  let low=minimumSize;
  let high=startSize;
  let best=minimumSize;

  // Keep the largest possible type size that renders in no more than two lines.
  if(applySize(high)<=2){
    best=high;
  }else{
    for(let i=0;i<16;i+=1){
      const mid=(low+high)/2;
      if(applySize(mid)<=2){
        best=mid;
        low=mid;
      }else{
        high=mid;
      }
    }
  }

  node.style.fontSize=`${best.toFixed(2)}px`;
  node.style.lineHeight=String(lineHeightRatio);
  node.style.maxHeight=`${(best*lineHeightRatio*2+3).toFixed(2)}px`;
}

function scheduleProductTitleFit(){
  const run=()=>document.querySelectorAll('[data-product-title]').forEach(fitProductTitleToTwoLines);
  requestAnimationFrame(()=>requestAnimationFrame(run));
  if(document.fonts?.ready)document.fonts.ready.then(run).catch(()=>{});
}

async function renderDetail(){
  const root=document.querySelector('.product-detail');if(!root)return;
  const key=new URLSearchParams(location.search).get('product')||new URLSearchParams(location.search).get('id');if(!key)return;
  try{
    const products=await loadPublicProducts();
    const product=products.find(p=>String(p.code).toLowerCase()===String(key).toLowerCase()||p.slug===key);
    if(!product)throw new Error('Producto no encontrado');
    window.CasaGlickMetaPixel?.track?.('ViewContent',{content_ids:[String(product.code||product.id||key)],content_name:String(product.displayName||product.name||product.code||'Producto'),content_category:String(product.category||''),content_type:'product',value:Number.isFinite(Number(product.price))?Number(product.price):0,currency:'MXN'});
    document.querySelectorAll('[data-product-title]').forEach(node=>{
      node.textContent=String(product.displayName||'Producto').trim();
    });
    scheduleProductTitleFit();
    const codeNode=document.querySelector('[data-product-code]');if(codeNode)codeNode.textContent=product.code;
    const set=(selector,value)=>{const n=document.querySelector(selector);if(n)n.textContent=value||'—'};
    set('[data-product-description]',product.editorialDescription);set('[data-product-materials]',product.materials);set('[data-product-measures]',product.measures);set('[data-product-breadcrumb-name]',product.displayName);
    const categoryLink=document.querySelector('[data-product-category-link]');if(categoryLink){categoryLink.textContent=categoryLabel(product.category);categoryLink.href=`productos.html?filter=${product.category||'todo'}`}
    const hasStock=Number(product.stock)>0;const priceNode=document.querySelector('[data-product-price]');const originalPriceNode=document.querySelector('[data-product-original-price]');const hasDiscount=Boolean(product.hasDiscount&&product.originalPrice!==null&&Number(product.price)<Number(product.originalPrice));if(priceNode){priceNode.textContent=hasStock?money(product.price):'Sin stock';priceNode.classList.toggle('is-discounted',hasStock&&hasDiscount)}if(originalPriceNode){originalPriceNode.textContent=hasDiscount?money(product.originalPrice):'';originalPriceNode.hidden=!hasStock||!hasDiscount}
    const priceBlock=document.querySelector('[data-product-price-block]');if(priceBlock){priceBlock.hidden=false;priceBlock.classList.add('is-visible')}
    const stockNode=document.querySelector('[data-product-stock]');if(stockNode){stockNode.textContent=hasStock?`${product.stock} disponibles`:'';stockNode.hidden=!hasStock}
    await renderSwatches(product);
    const gallery=document.querySelector('.product-gallery');if(gallery){const availableImages=Array.isArray(product.images)&&product.images.length?product.images.filter(Boolean):[catalog.FALLBACK_IMAGE];gallery.innerHTML=availableImages.map((src,index)=>`<figure class="product-gallery__item${index===0?' product-gallery__item--hero':''}"><img data-product-image="${index}" src="${esc(src)}" alt="${esc(product.displayName)} Casa Glick${index?`, vista ${index+1}`:''}" loading="${index===0?'eager':'lazy'}" onerror="this.onerror=null;this.src='${catalog.FALLBACK_IMAGE}'" /><figcaption class="seo-image-caption">${esc(product.displayName)} Casa Glick${index?`, vista ${index+1}`:''}</figcaption></figure>`).join('');gallery.removeAttribute('aria-busy');gallery.classList.remove('product-detail-skeleton');document.querySelector('.product-info')?.classList.remove('product-detail-skeleton');document.body.classList.add('product-detail-loaded');document.dispatchEvent(new CustomEvent('casa-glick:gallery-updated'))}
    const quote=document.querySelector('[data-product-quote]');if(quote){const hasPrice=product.price!==null&&Number.isFinite(Number(product.price));const canAdd=hasStock&&hasPrice;if(canAdd){quote.textContent='Agregar a bolsa';quote.href='bolsa.html';quote.removeAttribute('target');quote.removeAttribute('rel');quote.onclick=event=>{event.preventDefault();window.CasaGlickCart?.add({id:product.id,code:product.code,name:product.displayName,price:Number(product.price),image:(product.images&&product.images[0])||catalog.FALLBACK_IMAGE,stock:Number(product.stock)});quote.classList.add('is-added');quote.textContent='Agregado a bolsa';setTimeout(()=>{quote.classList.remove('is-added');quote.textContent='Agregar a bolsa'},1300)}}else{quote.textContent='Cotizar';quote.target='_blank';quote.rel='noopener';quote.onclick=null;const reason=!hasStock?'sin stock':'sin precio';quote.href=`https://wa.me/525513004665?text=${encodeURIComponent(`Hola, quiero cotizar ${product.displayName} (${product.code}) de Casa Glick. Actualmente aparece ${reason}.`)}`}}
  }catch(error){console.error('No se pudo cargar el producto',error);document.querySelectorAll('.product-detail-skeleton').forEach(node=>node.classList.remove('product-detail-skeleton'))}
}

let productTitleResizeTimer;
window.addEventListener('resize',()=>{
  clearTimeout(productTitleResizeTimer);
  productTitleResizeTimer=setTimeout(scheduleProductTitleFit,120);
});

renderListing();
renderDetail();
