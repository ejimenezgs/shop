<?php

declare(strict_types=1);

require __DIR__ . '/bootstrap.php';
require_method('POST');

$payload = (string) file_get_contents('php://input');
$signature = (string) ($_SERVER['HTTP_STRIPE_SIGNATURE'] ?? '');

$config = [];
$signatureVerified = false;

try {
    $config = load_private_config();

    try {
        verify_stripe_signature(
            $payload,
            $signature,
            (string) ($config['stripe_webhook_secret'] ?? '')
        );

        $signatureVerified = true;
    } catch (Throwable $signatureError) {
        error_log(
            'stripe-webhook-signature: '
            . $signatureError->getMessage()
        );

        json_response([
            'error' => 'Firma de webhook inv芍lida.',
        ], 400);
    }

    $event = json_decode(
        $payload,
        true,
        512,
        JSON_THROW_ON_ERROR
    );

    $eventId = (string) ($event['id'] ?? '');
    $type = (string) ($event['type'] ?? '');

    if ($eventId === '') {
        throw new RuntimeException(
            'Evento sin identificador.'
        );
    }

    if (
        firestore_get(
            $config,
            'stripeWebhookEvents/' . $eventId
        )
    ) {
        json_response([
            'received' => true,
            'duplicate' => true,
        ]);
    }

    $object = $event['data']['object'] ?? [];

    $metadata = is_array($object['metadata'] ?? null)
        ? $object['metadata']
        : [];

    $orderId = (string) (
        $metadata['orderId']
        ?? $object['client_reference_id']
        ?? ''
    );

    if (
        $orderId === ''
        && $type === 'charge.refunded'
    ) {
        $paymentIntentId = (string) (
            $object['payment_intent'] ?? ''
        );

        if (
            preg_match(
                '/^pi_[A-Za-z0-9]+$/',
                $paymentIntentId
            )
        ) {
            $paymentIntent = stripe_request(
                $config,
                '/payment_intents/'
                    . rawurlencode($paymentIntentId),
                [],
                'GET'
            );

            $piMetadata = is_array(
                $paymentIntent['metadata'] ?? null
            )
                ? $paymentIntent['metadata']
                : [];

            $orderId = (string) (
                $piMetadata['orderId'] ?? ''
            );
        }
    }

    if ($orderId !== '') {
        $isSuccessfulCheckout = in_array(
            $type,
            [
                'checkout.session.completed',
                'checkout.session.async_payment_succeeded',
            ],
            true
        );

        if (
            $isSuccessfulCheckout
            && ($object['payment_status'] ?? '') === 'paid'
        ) {
            $order = firestore_get(
                $config,
                'orders/' . $orderId
            );

            if (!$order) {
                throw new RuntimeException(
                    'No se encontr車 la orden pagada.'
                );
            }

            if (
                ($order['paymentMethod'] ?? '')
                !== 'stripe'
            ) {
                throw new RuntimeException(
                    'La orden no corresponde a Stripe.'
                );
            }

            if (
                !hash_equals(
                    (string) (
                        $order['stripeSessionId'] ?? ''
                    ),
                    (string) ($object['id'] ?? '')
                )
            ) {
                throw new RuntimeException(
                    'La sesi車n pagada no corresponde '
                    . 'a la orden.'
                );
            }

            if (
                strtolower(
                    (string) ($object['currency'] ?? '')
                ) !== 'mxn'
            ) {
                throw new RuntimeException(
                    'La moneda confirmada por Stripe '
                    . 'no es v芍lida.'
                );
            }

            $expectedAmount = (int) round(
                ((float) ($order['total'] ?? 0)) * 100
            );

            $paidAmount = (int) (
                $object['amount_total'] ?? -1
            );

            if (
                $expectedAmount <= 0
                || $paidAmount !== $expectedAmount
            ) {
                throw new RuntimeException(
                    'El monto confirmado por Stripe '
                    . 'no coincide con la orden.'
                );
            }

            $orderItems = is_array(
                $order['items'] ?? null
            )
                ? $order['items']
                : [];

            $shippingDetails =
                $object['collected_information']
                    ['shipping_details']
                ?? $object['shipping_details']
                ?? null;

            $customerDetails =
                $object['customer_details'] ?? null;

            try {
                $reservation =
                    reserve_inventory_for_paid_order(
                        $config,
                        $orderId,
                        $orderItems,
                        $eventId
                    );

                firestore_patch(
                    $config,
                    'orders/' . $orderId,
                    [
                        'status' => 'Pagada',
                        'paymentStatus' => 'paid',
                        'inventoryStatus' =>
                            $reservation['status'],
                        'inventoryReservedAt' =>
                            new DateTimeImmutable(
                                'now',
                                new DateTimeZone('UTC')
                            ),
                        'paidAt' =>
                            new DateTimeImmutable(
                                'now',
                                new DateTimeZone('UTC')
                            ),
                        'stripeSessionId' =>
                            (string) ($object['id'] ?? ''),
                        'stripePaymentIntentId' =>
                            (string) (
                                $object['payment_intent']
                                ?? ''
                            ),
                        'stripeShippingDetails' =>
                            is_array($shippingDetails)
                                ? $shippingDetails
                                : null,
                        'stripeCustomerDetails' =>
                            is_array($customerDetails)
                                ? $customerDetails
                                : null,
                    ]
                );
            } catch (Throwable $inventoryError) {
                firestore_patch(
                    $config,
                    'orders/' . $orderId,
                    [
                        'status' =>
                            'Pagada - revisar inventario',
                        'paymentStatus' => 'paid',
                        'inventoryStatus' =>
                            'reservation_failed',
                        'inventoryError' =>
                            $inventoryError->getMessage(),
                        'paidAt' =>
                            new DateTimeImmutable(
                                'now',
                                new DateTimeZone('UTC')
                            ),
                        'stripeSessionId' =>
                            (string) ($object['id'] ?? ''),
                        'stripePaymentIntentId' =>
                            (string) (
                                $object['payment_intent']
                                ?? ''
                            ),
                        'stripeShippingDetails' =>
                            is_array($shippingDetails)
                                ? $shippingDetails
                                : null,
                        'stripeCustomerDetails' =>
                            is_array($customerDetails)
                                ? $customerDetails
                                : null,
                    ]
                );
            }

            // Enviar correos después de confirmar el pago. Un fallo de Brevo
            // se registra en la orden, pero nunca revierte ni bloquea la compra.
            try {
                $latestOrder = firestore_get(
                    $config,
                    'orders/' . $orderId
                ) ?? $order;

                $emailState = is_array(
                    $latestOrder['confirmationEmail'] ?? null
                )
                    ? $latestOrder['confirmationEmail']
                    : [];

                if (($emailState['status'] ?? '') !== 'sent') {
                    $emailAttempts = max(
                        0,
                        (int) ($emailState['attempts'] ?? 0)
                    ) + 1;

                    firestore_patch(
                        $config,
                        'orders/' . $orderId,
                        [
                            'confirmationEmail' => [
                                'status' => 'sending',
                                'attempts' => $emailAttempts,
                                'lastAttemptAt' =>
                                    new DateTimeImmutable(
                                        'now',
                                        new DateTimeZone('UTC')
                                    ),
                            ],
                        ]
                    );

                    $emailResult = send_paid_order_emails(
                        $config,
                        $latestOrder,
                        $orderId
                    );

                    firestore_patch(
                        $config,
                        'orders/' . $orderId,
                        [
                            'confirmationEmail' => [
                                'status' => 'sent',
                                'attempts' => $emailAttempts,
                                'sentAt' =>
                                    new DateTimeImmutable(
                                        'now',
                                        new DateTimeZone('UTC')
                                    ),
                                'customerMessageId' =>
                                    (string) (
                                        $emailResult['customerMessageId']
                                        ?? ''
                                    ),
                                'internalMessageId' =>
                                    (string) (
                                        $emailResult['internalMessageId']
                                        ?? ''
                                    ),
                            ],
                        ]
                    );
                }
            } catch (Throwable $emailError) {
                error_log(
                    'brevo-order-email: '
                    . $emailError->getMessage()
                );

                try {
                    $latestOrder = $latestOrder ?? $order;
                    $emailState = is_array(
                        $latestOrder['confirmationEmail'] ?? null
                    )
                        ? $latestOrder['confirmationEmail']
                        : [];
                    $emailAttempts = max(
                        0,
                        (int) ($emailState['attempts'] ?? 0)
                    ) + 1;

                    firestore_patch(
                        $config,
                        'orders/' . $orderId,
                        [
                            'confirmationEmail' => [
                                'status' => 'failed',
                                'attempts' => $emailAttempts,
                                'failedAt' =>
                                    new DateTimeImmutable(
                                        'now',
                                        new DateTimeZone('UTC')
                                    ),
                                'error' => mb_substr(
                                    $emailError->getMessage(),
                                    0,
                                    500
                                ),
                            ],
                        ]
                    );
                } catch (Throwable $emailLogError) {
                    error_log(
                        'brevo-order-email-log: '
                        . $emailLogError->getMessage()
                    );
                }
            }
        } elseif ($type === 'checkout.session.expired') {
            $order = firestore_get($config, 'orders/' . $orderId);
            if ($order && !in_array(strtolower((string)($order['paymentStatus'] ?? '')), ['paid', 'refunded'], true)) {
                $storedSessionId = trim((string)($order['stripeSessionId'] ?? ''));
                $eventSessionId = trim((string)($object['id'] ?? ''));
                if ($storedSessionId === '' || $eventSessionId === '' || hash_equals($storedSessionId, $eventSessionId)) {
                    $fields = [
                        'status' => 'No completado',
                        'paymentStatus' => 'expired',
                        'failureReason' => 'checkout_session_expired',
                        'stripeSessionId' => $eventSessionId,
                        'paymentClosedAt' => new DateTimeImmutable('now', new DateTimeZone('UTC')),
                    ];
                    if (($order['inventoryStatus'] ?? '') === 'reserved') {
                        try {
                            transition_inventory_reservation($config, $orderId, 'released', 'checkout_session_expired');
                            $fields['inventoryStatus'] = 'released';
                            $fields['inventoryReleasedAt'] = new DateTimeImmutable('now', new DateTimeZone('UTC'));
                        } catch (Throwable $releaseError) {
                            error_log('inventory-release-expired: ' . $releaseError->getMessage());
                            $fields['inventoryStatus'] = 'release_failed';
                            $fields['inventoryError'] = mb_substr($releaseError->getMessage(), 0, 500);
                        }
                    }
                    firestore_patch($config, 'orders/' . $orderId, $fields);
                }
            }
        } elseif ($type === 'checkout.session.async_payment_failed') {
            $order = firestore_get($config, 'orders/' . $orderId);
            if ($order && !in_array(strtolower((string)($order['paymentStatus'] ?? '')), ['paid', 'refunded'], true)) {
                $storedSessionId = trim((string)($order['stripeSessionId'] ?? ''));
                $eventSessionId = trim((string)($object['id'] ?? ''));
                if ($storedSessionId === '' || $eventSessionId === '' || hash_equals($storedSessionId, $eventSessionId)) {
                    $failureMessage = trim((string)($object['last_payment_error']['message'] ?? 'El método de pago asíncrono falló definitivamente.'));
                    $fields = [
                        'status' => 'No completado',
                        'paymentStatus' => 'failed',
                        'failureReason' => 'async_payment_failed',
                        'paymentFailureMessage' => mb_substr($failureMessage, 0, 500),
                        'stripeSessionId' => $eventSessionId,
                        'stripePaymentIntentId' => (string)($object['payment_intent'] ?? ''),
                        'paymentClosedAt' => new DateTimeImmutable('now', new DateTimeZone('UTC')),
                    ];
                    if (($order['inventoryStatus'] ?? '') === 'reserved') {
                        try {
                            transition_inventory_reservation($config, $orderId, 'released', 'async_payment_failed');
                            $fields['inventoryStatus'] = 'released';
                            $fields['inventoryReleasedAt'] = new DateTimeImmutable('now', new DateTimeZone('UTC'));
                        } catch (Throwable $releaseError) {
                            error_log('inventory-release-async-failed: ' . $releaseError->getMessage());
                            $fields['inventoryStatus'] = 'release_failed';
                            $fields['inventoryError'] = mb_substr($releaseError->getMessage(), 0, 500);
                        }
                    }
                    firestore_patch($config, 'orders/' . $orderId, $fields);
                }
            }
        } elseif ($type === 'payment_intent.payment_failed') {
            $order = firestore_get($config, 'orders/' . $orderId);
            if ($order && !in_array(strtolower((string)($order['paymentStatus'] ?? '')), ['paid', 'refunded'], true)) {
                $lastError = $object['last_payment_error'] ?? [];
                $safeMessage = trim((string)(is_array($lastError) ? ($lastError['message'] ?? '') : ''));
                if ($safeMessage === '') $safeMessage = 'El intento de pago no pudo completarse.';
                firestore_patch($config, 'orders/' . $orderId, [
                    'lastPaymentError' => mb_substr($safeMessage, 0, 500),
                    'lastPaymentAttemptAt' => new DateTimeImmutable('now', new DateTimeZone('UTC')),
                    'stripePaymentIntentId' => (string)($object['id'] ?? ''),
                ]);
            }
        } elseif (
            $type === 'charge.refunded'
            && (int) (
                $object['amount_refunded'] ?? 0
            ) >= (int) (
                $object['amount'] ?? PHP_INT_MAX
            )
        ) {
            $refundInventoryStatus = 'released';
            $refundInventoryError = null;

            try {
                transition_inventory_reservation(
                    $config,
                    $orderId,
                    'released',
                    'stripe_refund'
                );
            } catch (Throwable $releaseError) {
                error_log(
                    'inventory-release: '
                    . $releaseError->getMessage()
                );

                $refundInventoryStatus =
                    'release_failed';

                $refundInventoryError =
                    $releaseError->getMessage();
            }

            firestore_patch(
                $config,
                'orders/' . $orderId,
                [
                    'status' => 'Reembolsada',
                    'paymentStatus' => 'refunded',
                    'inventoryStatus' =>
                        $refundInventoryStatus,
                    'inventoryError' =>
                        $refundInventoryError,
                    'refundedAt' =>
                        new DateTimeImmutable(
                            'now',
                            new DateTimeZone('UTC')
                        ),
                ]
            );
        }
    }

    firestore_patch(
        $config,
        'stripeWebhookEvents/' . $eventId,
        [
            'type' => $type,
            'processedAt' =>
                new DateTimeImmutable(
                    'now',
                    new DateTimeZone('UTC')
                ),
        ]
    );

    json_response([
        'received' => true,
    ]);
} catch (Throwable $error) {
    error_log(
        'stripe-webhook: ' . $error->getMessage()
    );

    $response = [
        'error' => 'No se pudo procesar el webhook.',
    ];

    if (
        $signatureVerified
        && strtolower(
            trim(
                (string) (
                    $config['stripe_environment'] ?? ''
                )
            )
        ) === 'test'
    ) {
        $response['sandboxDetail'] =
            $error->getMessage()
            ?: 'Error interno sin detalle.';
    }

    json_response($response, 500);
}
