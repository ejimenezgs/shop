<?php
// Copy this file OUTSIDE public_html, ideally to:
// /home/YOUR_CPANEL_USER/private/casa-glick-shop.php
// Never commit the real file.
return [
    // Keep "test" while using Stripe Sandbox. Change to "live" only at launch.
    'stripe_environment' => 'test',
    'stripe_secret_key' => 'rk_test_REPLACE_ME',
    'stripe_webhook_secret' => 'whsec_REPLACE_ME',
    'firebase_project_id' => 'casaglick-439b2',
    // Dedicated Firebase Authentication user used only by the PHP backend.
    'firebase_web_api_key' => 'AIzaSyBu4DJAxE_mn7MsVZNa-PMu-WNuFNsEPGU',
    'firebase_auth_email' => 'stripe-backend@casaglick.com',
    'firebase_auth_password' => 'REPLACE_WITH_A_LONG_RANDOM_PASSWORD',
    // Optional extra identity check. Leave empty or copy the UID from Firebase Authentication.
    'firebase_auth_uid' => '',
    'site_url' => 'https://shop.casaglick.com',
    'inventory_url' => 'https://segel-inventario.vercel.app/api/catalogo',
    // Long random token used only by the private dispatch/release endpoint.
    'inventory_admin_token' => 'REPLACE_WITH_A_LONG_RANDOM_SECRET',

    // Brevo transactional email configuration.
    'brevo' => [
        'enabled' => true,
        'api_key' => 'xkeysib-REPLACE_ME',
        'sender_name' => 'Casa Glick',
        'sender_email' => 'no-reply@casaglick.com',
        'reply_to_email' => 'contacto@gruposegel.com',
        'reply_to_name' => 'Casa Glick',
        'internal_recipient' => 'contacto@gruposegel.com',
    ],
];
