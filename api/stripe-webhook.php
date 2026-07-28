<?php
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';
require_method('POST');

$payload = (string)file_get_contents('php://input');
$signature = (string)($_SERVER['HTTP_STRIPE_SIGNATURE'] ?? '');
try {
    $config = load_private_config();
    try {
        verify_stripe_signature($payload, $signature, (string)($config['stripe_webhook_secret'] ?? ''));
    } catch (Throwable $signatureError) {
        error_log('stripe-webhook-signature: ' . $signatureError->getMessage());
        json_response(['error' => 'Firma de webhook inválida.'], 400);
    }
    $event = json_decode($payload, true, 512, JSON_THROW_ON_ERROR);
    $eventId = (string)($event['id'] ?? '');
    $type = (string)($event['type'] ?? '');
    if (!$eventId) throw new RuntimeException('Evento sin identificador.');
    if (firestore_get($config, 'stripeWebhookEvents/' . $eventId)) json_response(['received' => true, 'duplicate' => true]);

    $object = $event['data']['object'] ?? [];
    $metadata = is_array($object['metadata'] ?? null) ? $object['metadata'] : [];
    $orderId = (string)($metadata['orderId'] ?? $object['client_reference_id'] ?? '');
    if ($orderId === '' && $type === 'charge.refunded') {
        $paymentIntentId = (string)($object['payment_intent'] ?? '');
        if (preg_match('/^pi_[A-Za-z0-9]+$/', $paymentIntentId)) {
            $paymentIntent = stripe_request($config, '/payment_intents/' . rawurlencode($paymentIntentId), [], 'GET');
            $piMetadata = is_array($paymentIntent['metadata'] ?? null) ? $paymentIntent['metadata'] : [];
            $orderId = (string)($piMetadata['orderId'] ?? '');
        }
    }
    if ($orderId !== '') {
        if (in_array($type, ['checkout.session.completed', 'checkout.session.async_payment_succeeded'], true) && ($object['payment_status'] ?? '') === 'paid') {
            $order = firestore_get($config, 'orders/' . $orderId);
            if (!$order) throw new RuntimeException('No se encontró la orden pagada.');
            if (($order['paymentMethod'] ?? '') !== 'stripe') throw new RuntimeException('La orden no corresponde a Stripe.');
            if (!hash_equals((string)($order['stripeSessionId'] ?? ''), (string)($object['id'] ?? ''))) {
                throw new RuntimeException('La sesión pagada no corresponde a la orden.');
            }
            if (strtolower((string)($object['currency'] ?? '')) !== 'mxn') {
                throw new RuntimeException('La moneda confirmada por Stripe no es válida.');
            }
            $expectedAmount = (int)round(((float)($order['total'] ?? 0)) * 100);
            $paidAmount = (int)($object['amount_total'] ?? -1);
            if ($expectedAmount <= 0 || $paidAmount !== $expectedAmount) {
                throw new RuntimeException('El monto confirmado por Stripe no coincide con la orden.');
            }
            $orderItems = is_array($order['items'] ?? null) ? $order['items'] : [];
            $shippingDetails = $object['collected_information']['shipping_details']
                ?? $object['shipping_details']
                ?? null;
            $customerDetails = $object['customer_details'] ?? null;
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
                    'stripeShippingDetails' => is_array($shippingDetails) ? $shippingDetails : null,
                    'stripeCustomerDetails' => is_array($customerDetails) ? $customerDetails : null,
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
                    'stripeShippingDetails' => is_array($shippingDetails) ? $shippingDetails : null,
                    'stripeCustomerDetails' => is_array($customerDetails) ? $customerDetails : null,
                ]);
            }
        } elseif ($type === 'checkout.session.expired') {
            firestore_patch($config, 'orders/' . $orderId, [
                'status' => 'Pago expirado',
                'paymentStatus' => 'expired',
                'stripeSessionId' => (string)($object['id'] ?? ''),
            ]);
        } elseif (in_array($type, ['payment_intent.payment_failed', 'checkout.session.async_payment_failed'], true)) {
            $paymentIntentId = $type === 'payment_intent.payment_failed'
                ? (string)($object['id'] ?? '')
                : (string)($object['payment_intent'] ?? '');
            firestore_patch($config, 'orders/' . $orderId, [
                'status' => 'Pago fallido',
                'paymentStatus' => 'failed',
                'stripePaymentIntentId' => $paymentIntentId,
                'paymentFailureMessage' => (string)($object['last_payment_error']['message'] ?? 'El pago no pudo completarse.'),
            ]);
        } elseif (
            $type === 'charge.refunded'
            && (int)($object['amount_refunded'] ?? 0) >= (int)($object['amount'] ?? PHP_INT_MAX)
        ) {
            $refundInventoryStatus = 'released';
            $refundInventoryError = null;
            try {
                transition_inventory_reservation($config, $orderId, 'released', 'stripe_refund');
            } catch (Throwable $releaseError) {
                error_log('inventory-release: ' . $releaseError->getMessage());
                $refundInventoryStatus = 'release_failed';
                $refundInventoryError = $releaseError->getMessage();
            }
            firestore_patch($config, 'orders/' . $orderId, [
                'status' => 'Reembolsada',
                'paymentStatus' => 'refunded',
                'inventoryStatus' => $refundInventoryStatus,
                'inventoryError' => $refundInventoryError,
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
    json_response(['error' => 'No se pudo procesar el webhook.'], 500);
}
