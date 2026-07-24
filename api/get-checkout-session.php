<?php
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';
require_method('GET');
try {
    $config = load_private_config();
    $sessionId = trim((string)($_GET['session_id'] ?? ''));
    if (!preg_match('/^cs_(test|live)_[A-Za-z0-9]+$/', $sessionId)) throw new RuntimeException('Sesión inválida.');
    $session = stripe_request($config, '/checkout/sessions/' . rawurlencode($sessionId), [], 'GET');
    $orderId = (string)($session['metadata']['orderId'] ?? $session['client_reference_id'] ?? '');
    $order = $orderId ? firestore_get($config, 'orders/' . $orderId) : null;
    if (!$order) throw new RuntimeException('No se encontró la orden.');
    $confirmed = ($session['payment_status'] ?? '') === 'paid' && ($order['paymentStatus'] ?? '') === 'paid';
    json_response([
        'confirmed' => $confirmed,
        'paymentStatus' => (string)($order['paymentStatus'] ?? 'pending'),
        'folio' => (string)($order['folio'] ?? ''),
        'total' => (float)($order['total'] ?? (($session['amount_total'] ?? 0) / 100)),
        'email' => (string)($session['customer_details']['email'] ?? $session['customer_email'] ?? ''),
    ]);
} catch (Throwable $error) {
    json_response(['error' => $error->getMessage() ?: 'No se pudo validar el pago.'], 400);
}
