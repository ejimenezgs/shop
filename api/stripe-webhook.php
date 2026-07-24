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
        if ($type === 'checkout.session.completed' && ($object['payment_status'] ?? '') === 'paid') {
            firestore_patch($config, 'orders/' . $orderId, [
                'status' => 'Pagada',
                'paymentStatus' => 'paid',
                'paidAt' => new DateTimeImmutable('now', new DateTimeZone('UTC')),
                'stripeSessionId' => (string)($object['id'] ?? ''),
                'stripePaymentIntentId' => (string)($object['payment_intent'] ?? ''),
            ]);
        } elseif ($type === 'checkout.session.expired') {
            firestore_patch($config, 'orders/' . $orderId, [
                'status' => 'Pago expirado',
                'paymentStatus' => 'expired',
                'stripeSessionId' => (string)($object['id'] ?? ''),
            ]);
        } elseif ($type === 'payment_intent.payment_failed') {
            firestore_patch($config, 'orders/' . $orderId, [
                'status' => 'Pago fallido',
                'paymentStatus' => 'failed',
                'stripePaymentIntentId' => (string)($object['id'] ?? ''),
                'paymentFailureMessage' => (string)($object['last_payment_error']['message'] ?? 'El pago no pudo completarse.'),
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
