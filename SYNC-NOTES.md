# Casa Glick Shop v71 Firebase Auth

- Stripe Checkout dinámico con PHP.
- Validación del precio y stock en servidor.
- Reserva automática de unidades al confirmar un pago.
- Cálculo público: disponible = existencia física - apartados.
- Transacciones Firestore para evitar dobles reservas concurrentes.
- Idempotencia por orden y evento de Stripe.
- Reutilización segura de la orden y sesión al regresar desde cancelación.
- Intentos nuevos para sesiones expiradas, sin duplicar la orden.
- Validación del monto, moneda e ID de sesión en el webhook.
- Consolidación de SKU repetidos antes de validar y reservar.
- Paginación de colecciones Firestore con más de 500 documentos.
- Estado de contingencia `reservation_failed` si el pago fue exitoso pero no pudo apartarse inventario.
- Endpoint privado para reintentar, despachar o liberar una reserva.
- Endpoint privado de diagnóstico para verificar la configuración Sandbox.
- Autenticación PHP mediante un usuario técnico de Firebase Authentication.
- No requiere JSON de cuenta de servicio ni excepción de Google Cloud.
- Permisos limitados mediante reglas para `stripe-backend@casaglick.com`.
- El despacho libera el apartado únicamente después de que almacén haya aplicado la salida física en su sistema.
- Caché: shop71auth.


## shop81checkout
- Checkout Stripe limitado a codigos postales de CDMX; exterior continua por WhatsApp.
- Direccion condicional para entrega a domicilio y envio gratis en CDMX.
- Nueva consulta publica limitada de estatus en order.html mediante api/order-status.php.
- Boton Ver orden en confirmaciones asistida y Stripe.


## shop81checkout
- Checkout desk reorganizado en 3 filas: Nombre(s)/Apellido, Teléfono/Correo, Código Postal/Tipo de entrega.
- Nuevo campo Apellido y ajuste de datos para guardar nombre completo + nombre/apellido por separado.
- Corrección visual para evitar que el input de correo se estire por el mensaje del código postal.
- Dirección completa queda debajo cuando el usuario elige Envío a domicilio y Comentarios debajo de dirección.
- Se agregaron 5 imágenes más a la sección Lifestyle del home.


## shop81checkout
- Lifestyle conserva 3 imágenes visibles por composición, pero avanza automáticamente para recorrer las 9 imágenes.
- Input de Código Postal y selector Tipo de entrega igualados a 52 px de altura.
- Logo PNG corregido aplicado a todos los headers de todas las páginas HTML.

- v75: Lifestyle desktop changed from 3-item visible carousel to full 9-image static gallery in repeating pattern of 1 large + 2 small blocks. Mobile vertical 9-image gallery preserved. Disabled desktop lifestyle carousel JS by scoping it to data-carousel only.

- v76: Lifestyle desktop updated to a true horizontal carousel. Images are grouped in repeating mosaic slides (1 large left + 2 small right) and scroll horizontally. Mobile keeps the vertical 9-image layout.

- v77: Lifestyle now uses the same horizontal 1-large + 2-small carousel on mobile. Desktop edge-hover scrolling and pointer drag were reinforced; native image dragging is disabled.

- v78: Fixed lifestyle track to be the actual scroll container. Desktop supports edge-hover scrolling and direct mouse drag. Mobile groups now fill nearly the full viewport with one large image and two stacked small images.

- v79: Carrusel Lifestyle reconstruido con scrollLeft real sobre el viewport, arrastre por pointer, desplazamiento por hover en bordes y rueda vertical convertida a horizontal. En móvil se reagrupan las imágenes de 2 en 2 en columnas apiladas horizontales.


## shop81checkout
- Lifestyle móvil: pares de imágenes cuadradas apiladas en columnas horizontales.
- Lifestyle desktop: desplazamiento por hover copiado del carrusel Brands de casaglick.com (zona de borde 16%, velocidad 0.32 px/ms).
- Se conserva arrastre con mouse y rueda horizontal/vertical sobre el carrusel.


## shop81checkout
- Restaurado el scroll horizontal real del Lifestyle en desktop con movimiento por bordes, arrastre con mouse y rueda.
- En móvil, cada columna de dos imágenes cuadradas se limita por ancho y altura disponible para mostrarse completa sin salir de la pantalla.

- v84: Desktop Lifestyle rebuilt as Womo-style infinite loop. Cursor position continuously steers the carousel left/right, direct mouse dragging remains available, desktop scrollbar is hidden, and click-to-zoom is preserved. Mobile layout remains unchanged.

- v85: Lifestyle desktop cursor-driven loop speed reduced by 30%. Mobile carousel now also uses a seamless three-set infinite loop while preserving the two-square-images-per-column layout.

- v86: Centered the active Lifestyle column on mobile with symmetric side insets while preserving the approved two-square-image column layout and infinite loop.

- v88: Added semantic SEO captions to static and dynamically generated product/content images without changing visual layouts. Added a tenth Lifestyle image using assets/about-materials-new.webp.

- v89: Brevo transactional emails integrated into the Stripe webhook. Successful paid orders send a branded confirmation to the customer and an internal new-sale notification to contacto@gruposegel.com. Firestore stores status, attempts, timestamps and Brevo message IDs; email failures are logged without blocking payment confirmation.

- v91: Consulta de orden muestra artículos, cantidades y total; en órdenes asistidas usa “Total a pagar”. Confirmación cambia a “Continuar en WhatsApp”, botón Ver orden outline y mayor separación antes de Volver a productos.
