# Casa Glick Shop v69

- Stripe Checkout dinámico con PHP.
- Validación del precio y stock en servidor.
- Reserva automática de unidades al confirmar un pago.
- Cálculo público: disponible = existencia física - apartados.
- Transacciones Firestore para evitar dobles reservas concurrentes.
- Idempotencia por orden y evento de Stripe.
- Estado de contingencia `reservation_failed` si el pago fue exitoso pero no pudo apartarse inventario.
- Endpoint privado para convertir la reserva en despacho o liberarla.
- El despacho libera el apartado únicamente después de que almacén haya aplicado la salida física en su sistema.
- Caché: shop69.
