<?php
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';
require_method('POST');

try {
    $config = load_private_config();
    require_same_origin($config);
    $input = read_json_body();
    $orderId = trim((string)($input['orderId'] ?? ''));
    $dispatchToken = trim((string)($input['dispatchToken'] ?? ''));
    if (!preg_match('/^[A-Za-z0-9_-]{8,128}$/', $orderId)) throw new RuntimeException('Orden inválida.');
    if (!preg_match('/^[A-Fa-f0-9]{32,128}$/', $dispatchToken)) throw new RuntimeException('Token de envío inválido.');

    $order = firestore_get($config, 'orders/' . $orderId);
    if (!$order) throw new RuntimeException('La solicitud no existe.');
    if (($order['paymentMethod'] ?? '') !== 'assisted' || ($order['paymentStatus'] ?? '') !== 'not_applicable') {
        throw new RuntimeException('La orden no corresponde al flujo asistido.');
    }
    if (!hash_equals((string)($order['emailDispatchToken'] ?? ''), $dispatchToken)) {
        throw new RuntimeException('Token de envío incorrecto.');
    }
    $folio = trim((string)($order['folio'] ?? ''));
    if (!preg_match('/^CG-[0-9]{8}-[A-Z0-9]{4}$/', $folio)) throw new RuntimeException('Folio inválido.');
    $createdAtClient = strtotime((string)($order['createdAtClient'] ?? ''));
    if (!$createdAtClient || abs(time() - $createdAtClient) > 1800) throw new RuntimeException('La solicitud ya no puede enviar notificaciones.');

    $state = is_array($order['assistedRequestEmail'] ?? null) ? $order['assistedRequestEmail'] : [];
    if (($state['status'] ?? '') === 'sent') {
        json_response(['sent' => true, 'duplicate' => true, 'whatsappUrl' => build_assisted_whatsapp_url($order)]);
    }

    $attempts = max(0, (int)($state['attempts'] ?? 0)) + 1;
    $customerState = is_array($state['customer'] ?? null) ? $state['customer'] : [];
    $internalState = is_array($state['internal'] ?? null) ? $state['internal'] : [];
    $customer = is_array($order['customer'] ?? null) ? $order['customer'] : [];
    $customerEmail = trim((string)($customer['email'] ?? ''));
    if (!filter_var($customerEmail, FILTER_VALIDATE_EMAIL)) throw new RuntimeException('La solicitud no tiene un correo válido.');
    $settings = brevo_settings($config);
    $customerMessage = build_customer_assisted_order_email($config, $order, $orderId);
    $internalMessage = build_internal_assisted_order_email($config, $order, $orderId);

    try {
        if (($customerState['status'] ?? '') !== 'sent') {
            $messageId = brevo_send_email(
                $config,
                [['email' => $customerEmail, 'name' => (string)($customer['name'] ?? '')]],
                $customerMessage['subject'],
                $customerMessage['html'],
                $customerMessage['text'],
                ['assisted-order-request', 'casa-glick-shop']
            );
            $customerState = [
                'status' => 'sent',
                'messageId' => $messageId,
                'sentAt' => new DateTimeImmutable('now', new DateTimeZone('UTC')),
            ];
            firestore_patch($config, 'orders/' . $orderId, [
                'assistedRequestEmail' => [
                    'status' => 'partial',
                    'attempts' => $attempts,
                    'customer' => $customerState,
                    'internal' => $internalState,
                ],
            ]);
        }

        if (($internalState['status'] ?? '') !== 'sent') {
            $messageId = brevo_send_email(
                $config,
                [['email' => (string)$settings['internal_recipient'], 'name' => 'Casa Glick']],
                $internalMessage['subject'],
                $internalMessage['html'],
                $internalMessage['text'],
                ['assisted-order-internal', 'casa-glick-shop']
            );
            $internalState = [
                'status' => 'sent',
                'messageId' => $messageId,
                'sentAt' => new DateTimeImmutable('now', new DateTimeZone('UTC')),
            ];
        }

        firestore_patch($config, 'orders/' . $orderId, [
            'assistedRequestEmail' => [
                'status' => 'sent',
                'attempts' => $attempts,
                'sentAt' => new DateTimeImmutable('now', new DateTimeZone('UTC')),
                'customer' => $customerState,
                'internal' => $internalState,
            ],
        ]);
        json_response([
            'sent' => true,
            'duplicate' => false,
            'whatsappUrl' => (string)$customerMessage['whatsappUrl'],
        ]);
    } catch (Throwable $emailError) {
        firestore_patch($config, 'orders/' . $orderId, [
            'assistedRequestEmail' => [
                'status' => 'failed',
                'attempts' => $attempts,
                'failedAt' => new DateTimeImmutable('now', new DateTimeZone('UTC')),
                'error' => mb_substr($emailError->getMessage(), 0, 500),
                'customer' => $customerState,
                'internal' => $internalState,
            ],
        ]);
        throw $emailError;
    }
} catch (Throwable $error) {
    error_log('send-assisted-order-emails: ' . $error->getMessage());
    json_response(['error' => $error->getMessage() ?: 'No se pudo enviar la confirmación de solicitud.'], 400);
}
