# Casa Glick Shop — Stripe Sandbox con PHP

Esta versión usa Stripe Checkout alojado. Las claves privadas nunca deben colocarse en HTML, JavaScript, Firestore, GitHub ni dentro de `public_html`.

## 1. Requisitos del servidor

- PHP 8.0 o superior; PHP 8.2 recomendado.
- Extensiones `curl`, `openssl`, `json` y `mbstring`.
- HTTPS activo en `https://shop.casaglick.com`.
- Acceso de escritura al directorio privado de la cuenta cPanel.

## 2. Configuración privada

Crea fuera de `public_html`:

```text
/home/TU_USUARIO_CPANEL/private/casa-glick-shop.php
```

Usa `private-config.example.php` como base:

```php
<?php
return [
    'stripe_environment' => 'test',
    'stripe_secret_key' => 'sk_test_...',
    'stripe_webhook_secret' => 'whsec_...',
    'firebase_project_id' => 'casaglick-439b2',
    'firebase_service_account_path' => '/home/TU_USUARIO_CPANEL/private/firebase-service-account.json',
    'site_url' => 'https://shop.casaglick.com',
    'inventory_url' => 'https://segel-inventario.vercel.app/api/catalogo',
    'inventory_admin_token' => 'UN_SECRETO_LARGO_Y_ALEATORIO',
];
```

`stripe_environment: test` impide usar accidentalmente una clave `sk_live_...` durante las pruebas.

## 3. Firebase Admin es obligatorio

El PHP necesita una cuenta de servicio porque:

- lee la orden privada antes de crear la sesión;
- corrige precios y total desde el servidor;
- procesa el webhook;
- actualiza estados;
- crea y libera reservas mediante transacciones.

Guarda el JSON únicamente en:

```text
/home/TU_USUARIO_CPANEL/private/firebase-service-account.json
```

Sin este archivo, **ni siquiera se puede abrir Stripe Checkout con esta arquitectura**, porque el endpoint debe leer y validar la orden privada antes de crear la sesión.

Si Google Cloud bloquea la creación del JSON mediante `iam.disableServiceAccountKeyCreation`, se requiere una excepción limitada al proyecto `casaglick` o migrar el backend a un entorno con credenciales administradas.

## 4. Webhook de Stripe Sandbox

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

Copia el secreto de firma `whsec_...` a la configuración privada. El webhook devuelve `400` para firmas inválidas y `500` para fallos internos recuperables, permitiendo que Stripe reintente.

## 5. Activar el modo Stripe

En `catalogSettings/admin`:

```text
stripeEnabled: true
checkoutMode: stripe
```

Si el documento no responde o ambos campos están ausentes, el frontend conserva el modo asistido.

## 6. Diagnóstico privado

Una vez desplegado, consulta:

```text
GET https://shop.casaglick.com/api/stripe-readiness.php
X-Inventory-Admin-Token: TU_TOKEN_PRIVADO
```

La respuesta `readyForSandbox: true` confirma PHP, extensiones, HTTPS, clave de prueba, secreto del webhook, Firebase, Firestore e inventario. Nunca devuelve secretos.

## 7. Pruebas

1. Publica `firestore.rules`.
2. Activa Stripe desde el Panel.
3. Agrega un producto publicado con precio y stock.
4. Completa checkout.
5. Confirma que Stripe abre en Sandbox y moneda MXN.
6. Paga con `4242 4242 4242 4242`, fecha futura y cualquier CVC.
7. En Stripe, confirma `200` para `checkout.session.completed`.
8. En Firestore, confirma:

```text
paymentStatus: paid
status: Pagada
inventoryStatus: reserved
```

9. Reenvía el mismo evento y comprueba que `reservedQuantity` no aumenta otra vez.
10. Cancela otro intento y vuelve al checkout: debe reutilizar la misma orden y sesión abierta.
11. Prueba una tarjeta rechazada, por ejemplo `4000 0000 0000 0002`: no debe crearse reserva.

## 8. Seguridad y validaciones incluidas

- Productos Stripe generados dinámicamente; no se duplica el catálogo.
- Precio, publicación y stock consultados nuevamente en servidor.
- Total del navegador ignorado y reemplazado por el cálculo del servidor.
- Firma del webhook verificada con el cuerpo original.
- Moneda, monto, orden e ID de sesión verificados antes de confirmar.
- Idempotencia por orden e intento de Checkout.
- Eventos Stripe registrados y reservas idempotentes.
- SKU repetidos consolidados antes de validar stock.
- Sesiones abiertas reutilizadas; sesiones expiradas crean un intento nuevo sobre la misma orden.
- Colecciones Firestore paginadas.
- Reservas realizadas mediante transacción.

## 9. Reservas y almacén

```text
disponible = existencia física - reservedQuantity
```

Colecciones:

- `inventoryStockReservations/{skuNormalizado}`
- `inventoryReservationOrders/{orderId}`
- `stripeWebhookEvents/{eventId}`

Si el pago fue confirmado pero la reserva falla, la orden queda:

```text
status: Pagada - revisar inventario
paymentStatus: paid
inventoryStatus: reservation_failed
```

### Reintentar una reserva

```json
{"orderId":"ID_FIRESTORE","action":"retry","reason":"Revisión manual"}
```

### Confirmar despacho

Úsalo solo después de que almacén haya descontado físicamente la salida:

```json
{"orderId":"ID_FIRESTORE","action":"dispatch","reason":"Despacho confirmado"}
```

### Liberar por cancelación

```json
{"orderId":"ID_FIRESTORE","action":"release","reason":"Cancelación confirmada"}
```

Los tres usan:

```text
POST /api/inventory-reservation-action.php
X-Inventory-Admin-Token: TU_TOKEN_PRIVADO
Content-Type: application/json
```

No expongas ese token en el navegador.

## 10. Paso a producción

Solo después de completar Sandbox:

1. Crear el webhook en la cuenta Stripe de Casa Glick.
2. Sustituir por `sk_live_...` y el nuevo `whsec_...`.
3. Cambiar `stripe_environment` a `live`.
4. Ejecutar una compra real controlada de bajo monto.
5. Confirmar orden, webhook, reserva, reembolso y despacho.
