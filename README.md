# Casa Glick Panel

Panel administrativo independiente para `panel.casaglick.com`.

## Estructura

- `index.html`
- `css/admin.css`
- `js/admin.js`
- `js/auth.js`
- `js/catalog-api.js`
- `js/firebase-config.js`
- `assets/`
- `firestore.rules`

## Datos

La API de inventario aporta producto, precio, stock, imágenes y categoría. El panel guarda en Firestore visibilidad, nombre editorial, descripción, orden, destacado y slug.

## Categorías

El normalizador compara todos los campos de categoría del producto y prioriza valores específicos sobre secciones generales como Interior o Exterior. Todas las mesas se agrupan en `Mesas`, excepto mesas de noche y burós, que se agrupan en `Habitación`.
