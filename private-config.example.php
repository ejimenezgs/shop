<?php
// Copy this file OUTSIDE public_html, ideally to:
// /home/YOUR_CPANEL_USER/private/casa-glick-shop.php
// Never commit the real file.
return [
    // Keep "test" while using Stripe Sandbox. Change to "live" only at launch.
    'stripe_environment' => 'test',
    'stripe_secret_key' => 'sk_test_REPLACE_ME',
    'stripe_webhook_secret' => 'whsec_REPLACE_ME',
    'firebase_project_id' => 'casaglick-439b2',
    // Prefer a path to the downloaded Firebase service account JSON.
    'firebase_service_account_path' => '/home/YOUR_CPANEL_USER/private/firebase-service-account.json',
    'site_url' => 'https://shop.casaglick.com',
    'inventory_url' => 'https://segel-inventario.vercel.app/api/catalogo',
    // Long random token used only by the private dispatch/release endpoint.
    'inventory_admin_token' => 'REPLACE_WITH_A_LONG_RANDOM_SECRET',
];
