# Casa Glick Shop - Stripe Checkout con PHP

Esta version usa Stripe Checkout alojado. Las claves secretas nunca deben colocarse en HTML o JavaScript.

## 1. Requisitos de cPanel

- PHP 8.0 o superior recomendado.
- Extensiones `curl` y `openssl` activas.
- HTTPS activo en `https://shop.casaglick.com`.
- Acceso al Administrador de archivos de cPanel.

## 2. Crear la configuracion privada

Crea fuera de `public_html` la carpeta:

```text
/home/TU_USUARIO_CPANEL/private/
```

Dentro crea `casa-glick-shop.php` usando `private-config.example.php` como base. Debe contener:

```php
<?php
return [
    'stripe_secret_key' => 'sk_test_...',
    'stripe_webhook_secret' => 'whsec_...',
    'firebase_project_id' => 'casaglick-439b2',
    'firebase_service_account_path' => '/home/TU_USUARIO_CPANEL/private/firebase-service-account.json',
    'site_url' => 'https://shop.casaglick.com',
    'inventory_url' => 'https://segel-inventario.vercel.app/api/catalogo',
];
```

No subas este archivo a GitHub ni lo coloques dentro de la carpeta publica.

## 3. Cuenta de servicio de Firebase

Descarga una cuenta de servicio del proyecto Firebase y guárdala como:

```text
/home/TU_USUARIO_CPANEL/private/firebase-service-account.json
```

El archivo debe permanecer fuera de `public_html`.

## 4. Configurar el webhook en Stripe

En Stripe Workbench agrega este endpoint:

```text
https://shop.casaglick.com/api/stripe-webhook.php
```

Eventos recomendados:

- `checkout.session.completed`
- `checkout.session.expired`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `payment_intent.payment_failed`

Copia el secreto `whsec_...` del endpoint al archivo privado.

## 5. Activar Stripe desde el Panel

En el documento `catalogSettings/admin`, el Panel debe guardar:

```text
stripeEnabled: true
checkoutMode: stripe
```

Al desactivarlo, el Shop conserva el flujo asistido por WhatsApp.

## 6. Prueba

Usa primero claves `sk_test_...`. En Stripe Checkout usa una tarjeta de prueba oficial, por ejemplo `4242 4242 4242 4242`, una fecha futura y cualquier CVC valido.

Verifica que:

1. Se cree una orden con `paymentStatus: pending`.
2. Stripe abra el checkout en MXN.
3. El webhook cambie la orden a `paymentStatus: paid` y `status: Pagada`.
4. `checkout-success.html` confirme el pago.

## Seguridad incluida

- La clave secreta y el secreto del webhook viven fuera del sitio publico.
- El servidor vuelve a consultar inventario, publicación, stock y precio.
- El total enviado por el navegador no se considera confiable.
- La firma de Stripe se valida usando el cuerpo original del webhook.
- Cada evento se registra para evitar procesamiento duplicado.
- La creación de Checkout Session valida el origen del Shop.
- Se usa una clave de idempotencia por orden.

## Reserva de inventario después del pago

La v69 separa tres cantidades:

- `physicalStock`: existencia que reporta la API de almacén.
- `reservedQuantity`: unidades pagadas y apartadas todavía no despachadas.
- `availableStock`: `physicalStock - reservedQuantity`.

Cuando Stripe confirma el pago, `stripe-webhook.php` crea la reserva en Firestore de forma transaccional. El Shop lee `inventoryStockReservations` y descuenta esos apartados del stock visible.

Colecciones privadas creadas por el backend:

- `inventoryStockReservations/{skuNormalizado}`: acumulado reservado por SKU.
- `inventoryReservationOrders/{orderId}`: detalle e historial de la reserva de cada orden.

Si una reserva no puede completarse después del cobro, la orden queda como `Pagada - revisar inventario` con `inventoryStatus: reservation_failed` para atención manual.

### Confirmar despacho o liberar una reserva

El backend incluye:

`POST /api/inventory-reservation-action.php`

Encabezado obligatorio:

`X-Inventory-Admin-Token: TU_TOKEN_PRIVADO`

Cuerpo para despacho, después de que almacén haya descontado físicamente la salida en su sistema:

```json
{"orderId":"ID_FIRESTORE_DE_LA_ORDEN","action":"dispatch","reason":"Despacho confirmado por almacén"}
```

Cuerpo para cancelación o liberación antes del despacho:

```json
{"orderId":"ID_FIRESTORE_DE_LA_ORDEN","action":"release","reason":"Cancelación o reembolso"}
```

Agrega a `/home/USUARIO/private/casa-glick-shop.php`:

```php
'inventory_admin_token' => 'GENERA_UN_SECRETO_LARGO_Y_ALEATORIO',
```

No expongas ese token en JavaScript. Debe utilizarlo únicamente el sistema de inventario, una integración de servidor o una herramienta administrativa segura.

### Reglas de Firestore

Publica el archivo `firestore.rules` incluido. Permite lectura pública únicamente del acumulado reservado para calcular disponibilidad; las escrituras de reservas permanecen bloqueadas para clientes y se realizan con Firebase Admin desde PHP.
