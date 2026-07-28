# Casa Glick Shop

Repositorio publico para `https://shop.casaglick.com`.

## Conexion con Panel

La tienda y `https://panel.casaglick.com` usan el mismo proyecto Firebase:

- Proyecto: `casaglick-439b2`
- Endpoint de inventario: `https://segel-inventario.vercel.app/api/catalogo`
- Coleccion editorial: `catalogProductOverrides`
- Configuracion general: `catalogSettings`
- Ordenes: `orders`

El Panel escribe visibilidad, orden, nombre editorial, descripcion, slug y destacados. La tienda lee esos cambios desde Firestore y los combina con precio, stock, imagenes, materiales, medidas, marca y categoria recibidos desde la API de inventario.

## Estructura

- `index.html`: inicio
- `productos.html`: catalogo
- `producto.html`: detalle
- `bolsa.html`: bolsa
- `checkout.html`: datos del cliente y generacion de orden
- `confirmacion.html`: confirmacion y WhatsApp
- `firebase-public-config.js`: configuracion publica de Firebase para Shop
- `catalog-api.js`: normalizacion de la API de inventario
- `catalog-public.js`: lectura publica de Firestore y render del catalogo

## Despliegue

El contenido de esta carpeta debe quedar directamente en la raiz documental de `shop.casaglick.com`, con `index.html` en el primer nivel.

No se necesita la carpeta del Panel dentro de este repositorio.

## Firestore

Las reglas de `firestore.rules` deben publicarse en el mismo proyecto Firebase. Permiten:

- lectura publica de ajustes del catalogo;
- escritura solo para administradores autenticados;
- creacion publica de ordenes validas;
- lectura y seguimiento de ordenes solo desde el Panel autenticado.

## Stripe Checkout (Sandbox)

El documento `catalogSettings/admin` controla el flujo:

- `stripeEnabled: false` o `checkoutMode: "assisted"`: orden + WhatsApp.
- `stripeEnabled: true` o `checkoutMode: "stripe"`: Stripe Checkout.

El backend PHP está en `api/`. No contiene secretos. Crea fuera de `public_html`:

`/home/TU_USUARIO/private/casa-glick-shop.php`

usando `private-config.example.php` como referencia, y guarda también ahí el JSON de la cuenta de servicio de Firebase. El webhook de Stripe debe apuntar a:

`https://shop.casaglick.com/api/stripe-webhook.php`

La cuenta de servicio es obligatoria también para crear la sesión, porque PHP valida la orden privada antes de llamar a Stripe.

Eventos configurados: `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `payment_intent.payment_failed` y `charge.refunded`.

La guía completa y la lista de pruebas están en `STRIPE-PHP-SETUP.md`.

## Web Design dinámico

El landing escucha en tiempo real `shopContent/home` mediante `js/shop-content.js`. Los bloques admitidos son `hero`, `products`, `showroom`, `about`, `brands` y `contact`. Si el documento, un campo o una imagen fallan, se conserva el contenido incluido en el HTML.
