<?php
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';
require_method('POST');

$payload = (string)file_get_contents('php://input');
$signature = (string)($_SERVER['HTTP_STRIPE_SIGNATURE'] ?? '');
try {
    $config = load_private_config();
    verify_stripe_signature($payload, $signature, (string)($config['stripe_webhook_secret'] ?? ''));
    $event = json_decode($payload, true, 512, JSON_THROW_ON_ERROR);
    $eventId = (string)($event['id'] ?? '');
    $type = (string)($event['type'] ?? '');
    if (!$eventId) throw new RuntimeException('Evento sin identificador.');
    if (firestore_get($config, 'stripeWebhookEvents/' . $eventId)) json_response(['received' => true, 'duplicate' => true]);

    $object = $event['data']['object'] ?? [];
    $metadata = is_array($object['metadata'] ?? null) ? $object['metadata'] : [];
    $orderId = (string)($metadata['orderId'] ?? $object['client_reference_id'] ?? '');
    if ($orderId !== '') {
        if (in_array($type, ['checkout.session.completed', 'checkout.session.async_payment_succeeded'], true) && ($object['payment_status'] ?? '') === 'paid') {
            $order = firestore_get($config, 'orders/' . $orderId);
            if (!$order) throw new RuntimeException('No se encontró la orden pagada.');
            $orderItems = is_array($order['items'] ?? null) ? $order['items'] : [];
            try {
                $reservation = reserve_inventory_for_paid_order($config, $orderId, $orderItems, $eventId);
                firestore_patch($config, 'orders/' . $orderId, [
                    'status' => 'Pagada',
                    'paymentStatus' => 'paid',
                    'inventoryStatus' => $reservation['status'],
                    'inventoryReservedAt' => new DateTimeImmutable('now', new DateTimeZone('UTC')),
                    'paidAt' => new DateTimeImmutable('now', new DateTimeZone('UTC')),
                    'stripeSessionId' => (string)($object['id'] ?? ''),
                    'stripePaymentIntentId' => (string)($object['payment_intent'] ?? ''),
                ]);
            } catch (Throwable $inventoryError) {
                firestore_patch($config, 'orders/' . $orderId, [
                    'status' => 'Pagada - revisar inventario',
                    'paymentStatus' => 'paid',
                    'inventoryStatus' => 'reservation_failed',
                    'inventoryError' => $inventoryError->getMessage(),
                    'paidAt' => new DateTimeImmutable('now', new DateTimeZone('UTC')),
                    'stripeSessionId' => (string)($object['id'] ?? ''),
                    'stripePaymentIntentId' => (string)($object['payment_intent'] ?? ''),
                ]);
            }
        } elseif ($type === 'checkout.session.expired') {
            firestore_patch($config, 'orders/' . $orderId, [
                'status' => 'Pago expirado',
                'paymentStatus' => 'expired',
                'stripeSessionId' => (string)($object['id'] ?? ''),
            ]);
        } elseif (in_array($type, ['payment_intent.payment_failed', 'checkout.session.async_payment_failed'], true)) {
            firestore_patch($config, 'orders/' . $orderId, [
                'status' => 'Pago fallido',
                'paymentStatus' => 'failed',
                'stripePaymentIntentId' => (string)($object['id'] ?? ''),
                'paymentFailureMessage' => (string)($object['last_payment_error']['message'] ?? 'El pago no pudo completarse.'),
            ]);
                } elseif (in_array($type, ['charge.refunded', 'refund.updated'], true)) {
            try {
                transition_inventory_reservation($config, $orderId, 'released', 'stripe_refund');
            } catch (Throwable $releaseError) {
                error_log('inventory-release: ' . $releaseError->getMessage());
            }
            firestore_patch($config, 'orders/' . $orderId, [
                'status' => 'Reembolsada',
                'paymentStatus' => 'refunded',
                'inventoryStatus' => 'released',
                'refundedAt' => new DateTimeImmutable('now', new DateTimeZone('UTC')),
            ]);
        }
    }
    firestore_patch($config, 'stripeWebhookEvents/' . $eventId, [
        'type' => $type,
        'processedAt' => new DateTimeImmutable('now', new DateTimeZone('UTC')),
    ]);
    json_response(['received' => true]);
} catch (Throwable $error) {
    error_log('stripe-webhook: ' . $error->getMessage());
    json_response(['error' => 'Webhook inválido.'], 400);
}
