# Casa Glick Shop — Stripe Sandbox con PHP y Firebase Authentication

Esta versión usa Stripe Checkout alojado y un usuario técnico de Firebase Authentication. No requiere una clave JSON de cuenta de servicio ni una excepción de políticas de Google Cloud.

## 1. Requisitos

- PHP 8.0 o superior; PHP 8.2 recomendado.
- Extensiones `curl`, `json` y `mbstring`.
- HTTPS activo en `https://shop.casaglick.com`.
- Acceso al archivo privado fuera de `public_html`.

## 2. Crear el usuario técnico de Firebase

En Firebase:

1. Abre **Authentication**.
2. En **Sign-in method**, habilita **Correo electrónico/contraseña**.
3. En **Users**, selecciona **Add user**.
4. Usa exactamente:

```text
stripe-backend@casaglick.com
```

5. Genera una contraseña aleatoria larga y única.
6. Opcionalmente copia el UID del usuario para verificar también su identidad desde PHP.

Este usuario no debe utilizarse para entrar al Panel ni agregarse a la lista de administradores. Las reglas incluidas solo le permiten operar órdenes, webhooks y reservas.

## 3. Configuración privada

Crea o actualiza:

```text
/home/gyu5la0fbzjq/private/casa-glick-shop.php
```

Usa:

```php
<?php
return [
    'stripe_environment' => 'test',
    'stripe_secret_key' => 'sk_test_...',
    'stripe_webhook_secret' => 'whsec_...',

    'firebase_project_id' => 'casaglick-439b2',
    'firebase_web_api_key' => 'AIzaSyBu4DJAxE_mn7MsVZNa-PMu-WNuFNsEPGU',
    'firebase_auth_email' => 'stripe-backend@casaglick.com',
    'firebase_auth_password' => 'CONTRASEÑA_ALEATORIA_DEL_USUARIO_TECNICO',
    'firebase_auth_uid' => '',

    'site_url' => 'https://shop.casaglick.com',
    'inventory_url' => 'https://segel-inventario.vercel.app/api/catalogo',
    'inventory_admin_token' => 'OTRO_SECRETO_LARGO_Y_ALEATORIO',
];
```

Si copiaste el UID del usuario, colócalo en `firebase_auth_uid`. Si no, déjalo como cadena vacía.

No subas este archivo a GitHub ni lo coloques dentro de `public_html`.

## 4. Publicar las reglas

Publica el archivo `firestore.rules` incluido antes de probar.

Las reglas:

- mantienen el catálogo y la configuración con lectura pública;
- permiten creación pública validada de órdenes;
- permiten al correo técnico leer y actualizar órdenes;
- permiten al correo técnico crear y modificar reservas y eventos de Stripe;
- no conceden al usuario técnico acceso general de administrador.

Las solicitudes PHP usan un Firebase ID token y, por tanto, están sujetas a estas reglas.

## 5. Webhook de Stripe Sandbox

Crea el endpoint en la misma cuenta Sandbox de la clave `sk_test_...`:

```text
https://shop.casaglick.com/api/stripe-webhook.php
```

Eventos:

- `checkout.session.completed`
- `checkout.session.expired`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `payment_intent.payment_failed`
- `charge.refunded`

Copia el secreto `whsec_...` al archivo privado.

## 6. Activar Stripe desde el Panel

En `catalogSettings/admin`:

```text
stripeEnabled: true
checkoutMode: stripe
```

No actives Stripe hasta que el diagnóstico indique que todo está listo.

## 7. Diagnóstico privado

Consulta:

```text
GET https://shop.casaglick.com/api/stripe-readiness.php
X-Inventory-Admin-Token: TU_INVENTORY_ADMIN_TOKEN
```

Debe devolver:

```json
{
  "readyForSandbox": true
}
```

El diagnóstico verifica PHP, extensiones, HTTPS, clave de prueba, secreto del webhook, autenticación de Firebase, permisos Firestore e inventario. Nunca devuelve contraseñas ni claves.

## 8. Prueba de pago

1. Mantén Stripe en modo prueba.
2. Agrega un producto publicado con precio y stock.
3. Completa checkout.
4. Confirma que Stripe abre en MXN.
5. Usa `4242 4242 4242 4242`, fecha futura y cualquier CVC.
6. En Stripe, confirma `200` para `checkout.session.completed`.
7. En Firestore, confirma:

```text
paymentStatus: paid
status: Pagada
inventoryStatus: reserved
```

8. Reenvía el mismo evento y verifica que `reservedQuantity` no aumente nuevamente.
9. Cancela otro intento y regresa al checkout: debe reutilizar la misma orden y sesión abierta.
10. Prueba `4000 0000 0000 0002`: no debe generarse reserva.

## 9. Reservas y almacén

```text
disponible = existencia física - reservedQuantity
```

Colecciones:

- `inventoryStockReservations/{skuNormalizado}`
- `inventoryReservationOrders/{orderId}`
- `stripeWebhookEvents/{eventId}`

Acciones privadas:

### Reintentar una reserva

```json
{"orderId":"ID_FIRESTORE","action":"retry","reason":"Revisión manual"}
```

### Confirmar despacho

Úsalo después de que almacén haya descontado físicamente la salida:

```json
{"orderId":"ID_FIRESTORE","action":"dispatch","reason":"Despacho confirmado"}
```

### Liberar una reserva

```json
{"orderId":"ID_FIRESTORE","action":"release","reason":"Cancelación confirmada"}
```

Endpoint y encabezado:

```text
POST /api/inventory-reservation-action.php
X-Inventory-Admin-Token: TU_INVENTORY_ADMIN_TOKEN
Content-Type: application/json
```

## 10. Seguridad incluida

- No existe una clave privada JSON.
- La contraseña técnica vive fuera de `public_html`.
- El usuario técnico tiene permisos limitados mediante reglas.
- Precios, publicación y stock se validan nuevamente en PHP.
- El total enviado por el navegador se ignora.
- El webhook valida firma, sesión, orden, moneda y monto.
- Las reservas son transaccionales e idempotentes.
- Los SKU repetidos se consolidan antes de reservar.
- Stripe Sandbox exige `sk_test_...` mientras `stripe_environment` sea `test`.

## 11. Paso a producción

Después de completar todas las pruebas:

1. Crea el webhook en la cuenta Stripe de Casa Glick.
2. Sustituye por `sk_live_...` y el nuevo `whsec_...`.
3. Cambia `stripe_environment` a `live`.
4. Mantén las mismas credenciales técnicas de Firebase.
5. Ejecuta una compra real controlada y verifica pago, reserva, reembolso y despacho.


## Brevo transactional email

The Stripe webhook now sends two messages after a paid Checkout session:

- Customer confirmation from `Casa Glick <no-reply@casaglick.com>`.
- Internal sale notification to `contacto@gruposegel.com`.

Keep the Brevo API key only in the private configuration file outside `public_html`, under the nested `brevo` array shown in `private-config.example.php`. The webhook stores delivery attempts and Brevo message IDs under `orders/{orderId}.confirmationEmail`. Brevo failures are logged but do not change the paid status of the order.
