<?php
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';
require_method('POST');

try {
    $config = load_private_config();
    $input = read_json_body();
    $orderId = trim((string)($input['orderId'] ?? ''));
    if (!preg_match('/^[A-Za-z0-9_-]{8,128}$/', $orderId)) throw new RuntimeException('Orden inválida.');
    $settings = firestore_get($config, 'catalogSettings/admin') ?? [];
    $stripeEnabled = ($settings['stripeEnabled'] ?? false) === true || ($settings['checkoutMode'] ?? '') === 'stripe';
    if (!$stripeEnabled) throw new RuntimeException('Stripe está desactivado en el panel.');
    $order = firestore_get($config, 'orders/' . $orderId);
    if (!$order) throw new RuntimeException('La orden no existe.');
    if (($order['paymentMethod'] ?? '') !== 'stripe' || ($order['paymentStatus'] ?? '') !== 'pending') {
        throw new RuntimeException('La orden no está disponible para pago.');
    }
    $validated = validate_order_items($config, is_array($order['items'] ?? null) ? $order['items'] : []);
    $customer = is_array($order['customer'] ?? null) ? $order['customer'] : [];
    $siteUrl = rtrim((string)($config['site_url'] ?? 'https://shop.casaglick.com'), '/');
    $params = [
        'mode' => 'payment',
        'customer_email' => trim((string)($customer['email'] ?? '')),
        'client_reference_id' => $orderId,
        'success_url' => $siteUrl . '/checkout-success.html?session_id={CHECKOUT_SESSION_ID}',
        'cancel_url' => $siteUrl . '/checkout-cancel.html?order_id=' . rawurlencode($orderId),
        'metadata' => ['orderId' => $orderId, 'folio' => (string)($order['folio'] ?? '')],
        'payment_intent_data' => ['metadata' => ['orderId' => $orderId, 'folio' => (string)($order['folio'] ?? '')]],
        'billing_address_collection' => 'required',
        'locale' => 'es',
    ];
    if (($customer['delivery'] ?? '') === 'Envío a domicilio') {
        $params['shipping_address_collection'] = ['allowed_countries' => ['MX']];
    }
    foreach ($validated['items'] as $index => $item) {
        $params['line_items'][$index] = [
            'quantity' => $item['quantity'],
            'price_data' => [
                        'unit_amount' => $item['unitAmount'],
                'product_data' => [
                    'name' => $item['name'],
                    'metadata' => ['code' => $item['code']],
                ],
            ],
        ];
    }
    $session = stripe_request($config, '/checkout/sessions', $params, 'POST', 'casa-glick-order-' . $orderId);
    if (empty($session['id']) || empty($session['url'])) throw new RuntimeException('Stripe no devolvió una sesión válida.');
    firestore_patch($config, 'orders/' . $orderId, [
        'stripeSessionId' => $session['id'],
        'total' => $validated['totalCents'] / 100,
        'subtotal' => $validated['totalCents'] / 100,
        'items' => array_map(fn($item) => [
            'code' => $item['code'],
            'name' => $item['name'],
            'quantity' => $item['quantity'],
            'price' => $item['unitAmount'] / 100,
        ], $validated['items']),
        'stripeSessionCreatedAt' => new DateTimeImmutable('now', new DateTimeZone('UTC')),
    ]);
    json_response(['url' => $session['url']]);
} catch (Throwable $error) {
    error_log('create-checkout-session: ' . $error->getMessage());
    json_response(['error' => $error->getMessage() ?: 'No se pudo iniciar el pago.'], 400);
}
