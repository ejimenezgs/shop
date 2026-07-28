<?php
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';
require_method('GET');

try {
    $config = load_private_config();
    require_inventory_admin_token($config);

    $checks = [
        'phpVersion' => PHP_VERSION,
        'phpSupported' => version_compare(PHP_VERSION, '8.0.0', '>='),
        'curl' => extension_loaded('curl'),
        'openssl' => extension_loaded('openssl'),
        'json' => extension_loaded('json'),
        'mbstring' => extension_loaded('mbstring'),
        'httpsSiteUrl' => str_starts_with((string)($config['site_url'] ?? ''), 'https://'),
        'stripeEnvironment' => (string)($config['stripe_environment'] ?? 'test'),
        'stripeTestKey' => str_starts_with((string)($config['stripe_secret_key'] ?? ''), 'sk_test_'),
        'webhookSecret' => str_starts_with((string)($config['stripe_webhook_secret'] ?? ''), 'whsec_'),
        'firebaseAuthEmail' => (string)($config['firebase_auth_email'] ?? ''),
        'firebaseAuthentication' => false,
        'firestore' => false,
        'inventory' => false,
    ];

    firebase_access_token($config);
    $checks['firebaseAuthentication'] = true;
    firestore_get($config, 'catalogSettings/admin');
    $checks['firestore'] = true;
    $checks['inventory'] = count(fetch_inventory($config)) > 0;

    $ready = !in_array(false, [
        $checks['phpSupported'],
        $checks['curl'],
        $checks['openssl'],
        $checks['json'],
        $checks['mbstring'],
        $checks['httpsSiteUrl'],
        $checks['stripeTestKey'],
        $checks['webhookSecret'],
        $checks['firebaseAuthentication'],
        $checks['firestore'],
        $checks['inventory'],
    ], true);

    json_response(['readyForSandbox' => $ready, 'checks' => $checks]);
} catch (Throwable $error) {
    error_log('stripe-readiness: ' . $error->getMessage());
    json_response([
        'readyForSandbox' => false,
        'error' => $error->getMessage() ?: 'No se pudo completar la revisión.',
    ], 500);
}
