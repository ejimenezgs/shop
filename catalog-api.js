(() => {
  const API_URL = 'https://segel-inventario.vercel.app/api/catalogo';
  const FALLBACK_IMAGE = 'assets/product-placeholder-cg.png';

  const normalizeKey = (value) => String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '');

  const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

  function findDeep(source, keys) {
    const wanted = new Set(keys.map(normalizeKey));
    const queue = [source];
    const seen = new Set();
    while (queue.length) {
      const current = queue.shift();
      if (!current || typeof current !== 'object' || seen.has(current)) continue;
      seen.add(current);
      for (const [key, value] of Object.entries(current)) {
        if (wanted.has(normalizeKey(key)) && value !== undefined && value !== null && value !== '') return value;
      }
      for (const value of Object.values(current)) {
        if (value && typeof value === 'object') queue.push(value);
      }
    }
    return undefined;
  }

  function asArray(value) {
    if (Array.isArray(value)) return value;
    if (!value) return [];
    if (typeof value === 'string') {
      const clean = value.trim();
      if (!clean) return [];
      if (/^https?:\/\//i.test(clean)) return [clean];
      return clean.split(/[,;|\n]/).map(item => item.trim()).filter(Boolean);
    }
    if (isObject(value)) return Object.values(value);
    return [];
  }

  function parseNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'boolean' || value === null || value === undefined || value === '') return null;
    if (isObject(value)) {
      const preferred = findDeep(value, [
        'total','cantidad','stock','existencia','existencias','disponible','disponibles',
        'available','quantity','qty','onHand','saldo','unidades'
      ]);
      if (preferred !== undefined && preferred !== value) return parseNumber(preferred);
      return null;
    }
    const original = String(value).trim();
    if (!original) return null;
    if (/^(si|sí|yes|available|disponible|en stock)$/i.test(original)) return 1;
    if (/^(no|not available|sin stock|agotado)$/i.test(original)) return 0;

    // Supports 1,234.50 as well as 1.234,50.
    let text = original.replace(/\s/g, '').replace(/[^0-9,.-]/g, '');
    if (!text) return null;
    const lastComma = text.lastIndexOf(',');
    const lastDot = text.lastIndexOf('.');
    if (lastComma > lastDot) {
      text = text.replace(/\./g, '').replace(',', '.');
    } else {
      text = text.replace(/,/g, '');
    }
    const number = Number(text);
    return Number.isFinite(number) ? number : null;
  }

  function parsePrice(value) {
    const number = parseNumber(value);
    return Number.isFinite(number) ? number : null;
  }

  const STOCK_EXACT_KEYS = new Set([
    'stock','stocktotal','totalstock','stockactual','stockdisponible','availablestock',
    'existencia','existencias','existenciatotal','totalexistencia','totalexistencias',
    'existenciaactual','existenciasactuales','existenciadisponible','existenciasdisponibles',
    'cantidadexistencia','cantidadexistente','cantidadactual','cantidaddisponible',
    'disponible','disponibles','available','availability','quantity','qty','onhand',
    'saldo','saldodisponible','inventarioactual','inventariodisponible','unidadesdisponibles'
  ]);

  function isStockKey(key) {
    const normalized = normalizeKey(key);
    if (STOCK_EXACT_KEYS.has(normalized)) return true;
    return /(stock|existenc|inventari|onhand)/.test(normalized)
      || /(cantidad|unidades).*(dispon|actual|exist)/.test(normalized)
      || /(dispon|available).*(cantidad|stock|exist|unidades)/.test(normalized);
  }

  function numericStockLeaves(value, seen = new Set()) {
    if (value === null || value === undefined || value === '') return [];
    if (typeof value !== 'object') {
      const parsed = parseNumber(value);
      return Number.isFinite(parsed) ? [parsed] : [];
    }
    if (seen.has(value)) return [];
    seen.add(value);
    const values = [];
    for (const [key, child] of Object.entries(value)) {
      if (isStockKey(key)) {
        if (child && typeof child === 'object') values.push(...numericStockLeaves(child, seen));
        else {
          const parsed = parseNumber(child);
          if (Number.isFinite(parsed)) values.push(parsed);
        }
      } else if (child && typeof child === 'object') {
        values.push(...numericStockLeaves(child, seen));
      }
    }
    return values;
  }

  function parseStock(raw) {
    // First prefer explicit totals so warehouse/detail values are not counted twice.
    const total = findDeep(raw, [
      'stockTotal','totalStock','existenciaTotal','totalExistencia','totalExistencias',
      'stockActual','existenciaActual','existenciaDisponible','stockDisponible',
      'cantidadDisponible','cantidadExistencia','saldoDisponible','onHand'
    ]);
    const parsedTotal = parseNumber(total);
    if (Number.isFinite(parsedTotal)) return Math.max(0, parsedTotal);

    // Then inspect every nested stock-like field. This supports API payloads whose
    // inventory is grouped by warehouse, branch, variant or presentation.
    const candidates = numericStockLeaves(raw).filter(Number.isFinite);
    if (candidates.length) {
      const positives = candidates.filter(value => value > 0);
      if (positives.length) {
        // When several leaves exist they normally represent separate warehouses.
        // Deduplicate identical repeated totals before adding them.
        const unique = [...new Set(positives)];
        return Math.max(0, unique.reduce((sum, value) => sum + value, 0));
      }
      return 0;
    }

    // Last-resort direct aliases used by simpler catalog payloads.
    const direct = findDeep(raw, [
      'stock','existencia','existencias','cantidad','disponible','disponibles',
      'available','availability','quantity','qty','saldo','inventario','inventory','unidades'
    ]);
    const parsed = parseNumber(direct);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  }

  function slugify(text) {
    return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function categoryText(value) {
    if (value === null || value === undefined) return '';
    if (Array.isArray(value)) return value.map(categoryText).filter(Boolean).join(' / ');
    if (isObject(value)) {
      // Resolve the label only inside the category object. Avoid searching the
      // whole product again, which could accidentally return the product name.
      const directAliases = [
        'nombre','name','titulo','title','label','value','descripcion','description',
        'categoria','category','subcategoria','subcategory','familia','family',
        'linea','line','rubro','clasificacion','classification'
      ];
      for (const alias of directAliases) {
        const match = Object.entries(value).find(([key]) => normalizeKey(key) === normalizeKey(alias));
        if (match && match[1] !== value) {
          const text = categoryText(match[1]);
          if (text) return text;
        }
      }
      return Object.values(value).map(categoryText).filter(Boolean).join(' / ');
    }
    return String(value).trim();
  }

  const CATEGORY_KEY_SCORES = new Map([
    ['categoria', 100], ['category', 100], ['categorias', 98], ['categories', 98],
    ['categorianombre', 96], ['nombrecategoria', 96], ['categoryname', 96],
    ['categoriaproducto', 95], ['productcategory', 95], ['categoriaweb', 95],
    ['subcategoria', 90], ['subcategory', 90], ['subcategorias', 89],
    ['familia', 84], ['familiaproducto', 84], ['family', 84],
    ['linea', 82], ['lineaproducto', 82], ['line', 82], ['sublinea', 81],
    ['rubro', 80], ['clasificacion', 78], ['classification', 78],
    ['departamento', 76], ['grupo', 72], ['grupoproducto', 72],
    ['tipoproducto', 68], ['producttype', 68], ['tipo', 60]
  ]);

  function categoryKeyScore(key) {
    const normalized = normalizeKey(key);
    if (CATEGORY_KEY_SCORES.has(normalized)) return CATEGORY_KEY_SCORES.get(normalized);
    if (normalized.includes('categoria') || normalized.includes('category')) return 92;
    if (normalized.includes('subcategoria') || normalized.includes('subcategory')) return 88;
    if (normalized.includes('familia') || normalized.includes('family')) return 82;
    if (normalized.includes('linea') || normalized.includes('rubro')) return 78;
    if (normalized.includes('clasificacion') || normalized.includes('classification')) return 76;
    return 0;
  }

  function getApiCategory(raw) {
    if (!raw || typeof raw !== 'object') return '';

    // The API category at product root always wins. This avoids selecting a
    // category-like field from an image, warehouse, price list or variant.
    const rootAliases = [
      'categoria','category','categorias','categories','categoriaNombre','nombreCategoria',
      'categoryName','categoriaProducto','productCategory','subcategoria','subcategory',
      'familia','family','familiaProducto','linea','line','lineaProducto','rubro',
      'clasificacion','classification','departamento','grupo','grupoProducto',
      'tipoProducto','productType','tipoArticulo','grupoArticulo','familiaArticulo',
      'categoriaDescripcion','descripcionCategoria','categoryDescription'
    ];
    for (const alias of rootAliases) {
      const match = Object.entries(raw).find(([key]) => normalizeKey(key) === normalizeKey(alias));
      if (match && match[1] !== undefined && match[1] !== null && match[1] !== '') {
        const text = categoryText(match[1]).replace(/\s+/g, ' ').trim();
        if (text) return text;
      }
    }

    const candidates = [];
    const queue = [{ value: raw, depth: 0 }];
    const seen = new Set();
    while (queue.length) {
      const { value, depth } = queue.shift();
      if (!value || typeof value !== 'object' || seen.has(value) || depth > 5) continue;
      seen.add(value);
      for (const [key, child] of Object.entries(value)) {
        const score = categoryKeyScore(key);
        if (score && child !== undefined && child !== null && child !== '') {
          const text = categoryText(child).replace(/\s+/g, ' ').trim();
          if (text) candidates.push({ text, score: score - depth * 4, depth });
        }
        if (child && typeof child === 'object') queue.push({ value: child, depth: depth + 1 });
      }
    }
    candidates.sort((a, b) => b.score - a.score || a.depth - b.depth || a.text.length - b.text.length);
    if (candidates[0]?.text) return candidates[0].text;

    // Last-resort semantic detection for APIs that expose the category under a
    // custom key. It only recognizes known furniture category values.
    const semantic = [];
    const walk = [raw];
    const walked = new Set();
    while (walk.length) {
      const current = walk.shift();
      if (!current || typeof current !== 'object' || walked.has(current)) continue;
      walked.add(current);
      for (const value of Object.values(current)) {
        if (value && typeof value === 'object') walk.push(value);
        else if (typeof value === 'string' && !/^https?:\/\//i.test(value)) {
          const clean = value.replace(/\s+/g, ' ').trim();
          if (/mesa(?:s)?\s+de\s+centro|coffee\s+table|poltrona|sillon|sillón|butaca|silla|banco|taburete|mesa|buro|buró|consola|escritorio|sofa|sofá|seccional|love seat|lampara|lámpara|iluminacion|iluminación|candil|decoracion|decoración|espejo|cuadro|florero/i.test(clean)) semantic.push(clean);
        }
      }
    }
    return semantic.sort((a, b) => a.length - b.length)[0] || '';
  }

  function normalizeCategory(apiCategory) {
    const text = String(apiCategory || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

    // La categoría siempre nace del API. Solo se agrupan subcategorías equivalentes
    // dentro de las categorías públicas de Casa Glick.
    if (/mesa(?:s)?\s+de\s+centro|mesa(?:s)?\s+centro|coffee\s+table/.test(text)) return 'mesas';
    if (/poltrona|sillon individual|butaca/.test(text)) return 'poltronas';
    if (/silla|banco|taburete/.test(text)) return 'sillas';
    if (/mesa|buro|consola|escritorio/.test(text)) return 'mesas';
    if (/sofa|seccional|love seat/.test(text)) return 'sofas';
    if (/lampara|iluminacion|candil/.test(text)) return 'iluminacion';
    if (/decor|espejo|cuadro|florero|accesorio/.test(text)) return 'decoracion';
    return text ? slugify(text) : '';
  }

  function normalizeProduct(raw, index = 0) {
    const code = String(findDeep(raw, ['codigo','code','sku','clave','idProducto','productId','id']) || `product-${index + 1}`);
    const name = String(findDeep(raw, ['nombre','name','titulo','title','descripcionCorta']) || `Producto ${index + 1}`);
    const imageSource = findDeep(raw, ['imagenes','images','fotos','photos','imageUrls','galeria','gallery']);
    const directImage = findDeep(raw, ['imagen','image','foto','photo','imageUrl','urlImagen','portada','thumbnail']);
    const images = asArray(imageSource).map(item => {
      if (typeof item === 'string') return item;
      return findDeep(item, ['url','src','imageUrl','imagen','foto']) || '';
    }).filter(Boolean);
    if (directImage && typeof directImage === 'string' && !images.includes(directImage)) images.unshift(directImage);

    const apiCategory = getApiCategory(raw);
    const category = normalizeCategory(apiCategory);
    return {
      id: code,
      raw,
      code,
      name,
      description: String(findDeep(raw, ['descripcion','description','detalle','details','descripcionLarga']) || ''),
      color: String(findDeep(raw, ['color','colores']) || '—'),
      materials: String(findDeep(raw, ['materiales','materials','material']) || '—'),
      measures: String(findDeep(raw, ['medidas','measures','dimensions','dimensiones']) || '—'),
      brand: String(findDeep(raw, ['marca','brand','fabricante','manufacturer','proveedorMarca']) || 'Sin marca'),
      apiCategory,
      category,
      price: parsePrice(findDeep(raw, ['precio','price','precioVenta','salePrice','precioPublico','precioLista'])),
      stock: parseStock(raw),
      images: images.length ? images : [FALLBACK_IMAGE],
      slug: slugify(`${name}-${code}`)
    };
  }

  function unwrapPayload(payload) {
    if (Array.isArray(payload)) return payload;
    for (const key of ['productos','products','data','catalogo','items','result','results']) {
      if (Array.isArray(payload?.[key])) return payload[key];
      if (Array.isArray(payload?.data?.[key])) return payload.data[key];
    }
    return [];
  }

  async function fetchProducts(url = API_URL) {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    return unwrapPayload(payload).map(normalizeProduct);
  }

  window.CasaGlickCatalog = { API_URL, FALLBACK_IMAGE, findDeep, normalizeProduct, unwrapPayload, fetchProducts, slugify };
})();
