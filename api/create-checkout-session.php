<?php
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';
require_method('POST');

try {
    $config = load_private_config();
    require_same_origin($config);
    $input = read_json_body();
    $orderId = trim((string)($input['orderId'] ?? ''));
    if (!preg_match('/^[A-Za-z0-9_-]{8,128}$/', $orderId)) throw new RuntimeException('Orden inválida.');
    $settings = firestore_get($config, 'catalogSettings/admin') ?? [];
    $stripeEnabled = ($settings['stripeEnabled'] ?? false) === true || ($settings['checkoutMode'] ?? '') === 'stripe';
    if (!$stripeEnabled) throw new RuntimeException('Stripe está desactivado en el panel.');
    $order = firestore_get($config, 'orders/' . $orderId);
    if (!$order) throw new RuntimeException('La orden no existe.');
    $paymentStatus = (string)($order['paymentStatus'] ?? '');
    if (($order['paymentMethod'] ?? '') !== 'stripe' || !in_array($paymentStatus, ['pending', 'expired', 'failed'], true)) {
        throw new RuntimeException('La orden no está disponible para pago.');
    }
    $validated = validate_order_items($config, is_array($order['items'] ?? null) ? $order['items'] : []);
    $customer = is_array($order['customer'] ?? null) ? $order['customer'] : [];
    $customerEmail = trim((string)($customer['email'] ?? ''));
    if (!filter_var($customerEmail, FILTER_VALIDATE_EMAIL) || strlen($customerEmail) > 254) {
        throw new RuntimeException('El correo de la orden no es válido.');
    }
    $customerName = trim((string)($customer['name'] ?? ''));
    $customerPhone = preg_replace('/\D+/', '', (string)($customer['phone'] ?? ''));
    if (mb_strlen($customerName) < 2 || mb_strlen($customerName) > 120 || strlen($customerPhone) !== 10) {
        throw new RuntimeException('Los datos del cliente no son válidos.');
    }
    $postalCode = preg_replace('/\D+/', '', (string)($customer['postalCode'] ?? ''));
    $postalNumber = (int)$postalCode;
    if (strlen($postalCode) !== 5 || $postalNumber < 1000 || $postalNumber > 16999) {
        throw new RuntimeException('Stripe está disponible únicamente para códigos postales de CDMX.');
    }
    if (($customer['delivery'] ?? '') === 'Envío a domicilio' && trim((string)($customer['address'] ?? '')) === '') {
        throw new RuntimeException('Falta la dirección de entrega.');
    }

    $existingSessionId = trim((string)($order['stripeSessionId'] ?? ''));
    if (preg_match('/^cs_(test|live)_[A-Za-z0-9]+$/', $existingSessionId)) {
        $existingSession = stripe_request($config, '/checkout/sessions/' . rawurlencode($existingSessionId), [], 'GET');
        if (($existingSession['payment_status'] ?? '') === 'paid') {
            throw new RuntimeException('Esta orden ya fue pagada.');
        }
        if (($existingSession['status'] ?? '') === 'open' && !empty($existingSession['url'])) {
            json_response([
                'url' => (string)$existingSession['url'],
                'sessionId' => $existingSessionId,
                'reused' => true,
            ]);
        }
    }

    $previousAttempt = max(0, (int)($order['checkoutAttempt'] ?? 0));
    if ($previousAttempt >= 20) throw new RuntimeException('La orden alcanzó el límite de intentos de pago.');
    $attempt = $previousAttempt + 1;
    $siteUrl = rtrim((string)($config['site_url'] ?? 'https://shop.casaglick.com'), '/');
    $params = [
        'mode' => 'payment',
        'payment_method_types' => ['card'],
        'customer_email' => $customerEmail,
        'client_reference_id' => $orderId,
        'success_url' => $siteUrl . '/checkout-success.html?session_id={CHECKOUT_SESSION_ID}',
        'cancel_url' => $siteUrl . '/checkout-cancel.html?order_id=' . rawurlencode($orderId),
        'metadata' => [
            'orderId' => $orderId,
            'folio' => (string)($order['folio'] ?? ''),
            'checkoutAttempt' => (string)$attempt,
        ],
        'payment_intent_data' => [
            'metadata' => [
                'orderId' => $orderId,
                'folio' => (string)($order['folio'] ?? ''),
                'checkoutAttempt' => (string)$attempt,
            ],
        ],
        'billing_address_collection' => 'required',
        'locale' => 'es',
        'expires_at' => time() + 1860,
    ];
    if (($customer['delivery'] ?? '') === 'Envío a domicilio') {
        $params['shipping_address_collection'] = ['allowed_countries' => ['MX']];
    }
    foreach ($validated['items'] as $index => $item) {
        $params['line_items'][$index] = [
            'quantity' => $item['quantity'],
            'price_data' => [
                'currency' => 'mxn',
                'unit_amount' => $item['unitAmount'],
                'product_data' => [
                    'name' => $item['name'],
                    'images' => $item['image'] ? [$item['image']] : [],
                    'metadata' => ['code' => $item['code']],
                ],
            ],
        ];
    }
    $session = stripe_request(
        $config,
        '/checkout/sessions',
        $params,
        'POST',
        'casa-glick-order-' . $orderId . '-attempt-' . $attempt
    );
    if (empty($session['id']) || empty($session['url'])) throw new RuntimeException('Stripe no devolvió una sesión válida.');
    firestore_patch($config, 'orders/' . $orderId, [
        'stripeSessionId' => $session['id'],
        'checkoutAttempt' => $attempt,
        'status' => 'Pendiente de pago',
        'paymentStatus' => 'pending',
        'total' => $validated['totalCents'] / 100,
        'subtotal' => $validated['totalCents'] / 100,
        'items' => array_map(fn($item) => [
            'code' => $item['code'],
            'name' => $item['name'],
            'image' => $item['image'],
            'quantity' => $item['quantity'],
            'price' => $item['unitAmount'] / 100,
        ], $validated['items']),
        'stripeSessionCreatedAt' => new DateTimeImmutable('now', new DateTimeZone('UTC')),
    ]);
    json_response([
        'url' => $session['url'],
        'sessionId' => $session['id'],
        'reused' => false,
    ]);
} catch (Throwable $error) {
    error_log('create-checkout-session: ' . $error->getMessage());
    json_response(['error' => $error->getMessage() ?: 'No se pudo iniciar el pago.'], 400);
}
