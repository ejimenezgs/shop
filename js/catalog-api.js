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

  function collectDeepEntries(source) {
    const entries = [];
    const queue = [{ value: source, path: [] }];
    const seen = new Set();
    while (queue.length) {
      const { value, path } = queue.shift();
      if (!value || typeof value !== 'object' || seen.has(value)) continue;
      seen.add(value);
      for (const [key, child] of Object.entries(value)) {
        const nextPath = [...path, key];
        entries.push({ key, normalizedKey: normalizeKey(key), path: nextPath, value: child });
        if (child && typeof child === 'object') queue.push({ value: child, path: nextPath });
      }
    }
    return entries;
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

  const BROAD_CATEGORY_VALUES = /^(interior|exterior|decoracion|decoración|habitacion|habitación|mobiliario|general|catalogo|catálogo)$/i;
  const SPECIFIC_CATEGORY_VALUE = /(mesa(?:s)?(?:\s+de\s+(?:centro|comedor|noche|jardin|jardín|auxiliar|lateral))?|coffee\s+table|dining\s+table|nightstand|bur[oó](?:\s+de\s+noche)?|poltrona|sof[aá](?:s)?\s+individual(?:es)?|sill[oó]n(?:es)?\s+individual(?:es)?|sill[oó]n|butaca|silla|banco|taburete|ottoman|otomano|sof[aá]|seccional|love\s*seat|camastro|cama|cabecera|l[aá]mpara|iluminaci[oó]n|candil|espejo|cuadro|florero|consola|escritorio)/i;

  function categoryValueScore(text) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (!clean) return -1000;
    if (BROAD_CATEGORY_VALUES.test(clean)) return -180;
    if (SPECIFIC_CATEGORY_VALUE.test(clean)) return 180;
    return 0;
  }

  function getApiCategory(raw) {
    if (!raw || typeof raw !== 'object') return '';

    const candidates = [];
    const seen = new Set();
    const queue = [{ value: raw, depth: 0, parentKey: '' }];
    while (queue.length) {
      const { value, depth, parentKey } = queue.shift();
      if (!value || typeof value !== 'object' || seen.has(value) || depth > 6) continue;
      seen.add(value);
      for (const [key, child] of Object.entries(value)) {
        const keyScore = categoryKeyScore(key);
        if (keyScore && child !== undefined && child !== null && child !== '') {
          const text = categoryText(child).replace(/\s+/g, ' ').trim();
          if (text) {
            candidates.push({
              text,
              score: keyScore + categoryValueScore(text) - depth * 5,
              depth,
              key
            });
          }
        }

        // Some inventory systems expose the specific category under custom keys.
        // Consider only short furniture-like values, never descriptions, names or URLs.
        if (typeof child === 'string') {
          const clean = child.replace(/\s+/g, ' ').trim();
          const normalizedKey = normalizeKey(key);
          const excludedKey = /(descripcion|description|nombre|name|titulo|title|imagen|image|url|marca|brand|color|material|medida|dimension)/.test(normalizedKey);
          if (!excludedKey && clean.length <= 80 && SPECIFIC_CATEGORY_VALUE.test(clean)) {
            candidates.push({
              text: clean,
              score: 170 + Math.max(0, 20 - depth * 4),
              depth,
              key: parentKey ? `${parentKey}.${key}` : key
            });
          }
        }

        if (child && typeof child === 'object') {
          queue.push({ value: child, depth: depth + 1, parentKey: key });
        }
      }
    }

    candidates.sort((a, b) =>
      b.score - a.score ||
      a.depth - b.depth ||
      a.text.length - b.text.length
    );
    return candidates[0]?.text || '';
  }

  function normalizeCategory(apiCategory) {
    const text = String(apiCategory || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

    // Public shop departments. The panel now exposes the source category,
    // and the shop groups it into the five customer-facing departments.
    if (/decoracion|decoración/.test(text)) return 'decoracion';
    if (/iluminacion|iluminación|lampara|lámpara|candil|luminaria|lighting/.test(text)) return 'iluminacion';
    if (/exterior|outdoor|jardin|jardín|garden|terraza|patio|alberca|camastro/.test(text)) return 'exterior';
    if (/habitacion|habitación|recamara|recámara|dormitorio|\bcamas?\b|cabecera|mesa(?:s)?\s+de\s+noche|nightstand|bur[oó]/.test(text)) return 'habitacion';
    if (/interior|silla|mesa|sof[aá]|ottoman|otomano|poltrona|sill[oó]n(?:es)?\s+individual(?:es)?|sof[aá](?:s)?\s+individual(?:es)?/.test(text)) return 'interior';
    return '';
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

    // Inspect every category/classification field instead of stopping at the
    // first one. Inventory payloads often expose a broad value such as
    // "Mobiliario" before the useful category (for example "Sillas").
    const apiCategory = getApiCategory(raw) || categoryText(findDeep(raw, [
      'categoria','category','categoriaNombre','nombreCategoria','categoryName',
      'categoriaProducto','productCategory','subcategoria','subcategory','familia','family','linea','line'
    ]));
    const category = normalizeCategory(apiCategory);

    // Promotion payloads differ between inventory versions. Read both direct
    // aliases and nested objects, then validate by comparing the two prices.
    const entries = collectDeepEntries(raw);
    const firstPriceFor = patterns => {
      for (const entry of entries) {
        const normalizedPath = entry.path.map(normalizeKey).join('.');
        const contextualPriceKey = /(precio|price|promoc|oferta|discount|sale)/.test(normalizedPath);
        const matched = patterns.some(pattern => pattern.test(entry.normalizedKey))
          || (contextualPriceKey && patterns.some(pattern => pattern.test(normalizedPath)));
        if (!matched) continue;
        const parsed = parsePrice(entry.value);
        if (parsed !== null) return parsed;
      }
      return null;
    };

    const regularPrice = firstPriceFor([
      /preciooriginal/, /originalprice/, /precioantes/, /precioanterior/, /previousprice/,
      /preciolista/, /listprice/, /precioregular/, /regularprice/, /pricebefore/,
      /preciosindescuento/, /precioantesdescuento/, /baseprice/, /msrp/, /previous$/, /before$/
    ]);
    const promotionalPrice = firstPriceFor([
      /preciopromocion/, /promotionprice/, /promoprice/, /preciodescuento/, /discountprice/,
      /discountedprice/, /preciooferta/, /saleprice/, /preciocondescuento/, /preciofinal/,
      /precioespecial/, /specialprice/, /currentprice/, /preciopromo/, /current$/, /final$/
    ]);
    const fallbackPrice = parsePrice(findDeep(raw, [
      'precio','price','precioVenta','precioPublico','precioActual','currentPrice','venta'
    ]));

    // Some APIs replace `precio` with the promotional value and expose only
    // the previous/list value separately. Support that shape explicitly.
    let price = promotionalPrice ?? fallbackPrice ?? regularPrice;
    let originalPrice = null;
    if (regularPrice !== null && price !== null && price < regularPrice) {
      originalPrice = regularPrice;
    } else if (promotionalPrice !== null && fallbackPrice !== null) {
      const lower = Math.min(promotionalPrice, fallbackPrice);
      const higher = Math.max(promotionalPrice, fallbackPrice);
      price = lower;
      if (lower < higher) originalPrice = higher;
    }

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
      price,
      originalPrice,
      hasDiscount: Boolean(originalPrice !== null && price !== null && price < originalPrice),
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
