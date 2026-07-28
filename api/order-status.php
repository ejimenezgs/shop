<?php
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';
require_method('GET');
try {
    $config = load_private_config();
    require_same_origin($config);
    $folio = strtoupper(trim((string)($_GET['folio'] ?? '')));
    if (!preg_match('/^CG-[A-Z0-9-]{8,35}$/', $folio)) throw new RuntimeException('Número de orden inválido.');
    $matched = null;
    foreach (firestore_list($config, 'orders', 500) as $entry) {
        $data = $entry['data'] ?? [];
        if (hash_equals($folio, strtoupper(trim((string)($data['folio'] ?? ''))))) { $matched = $data; break; }
    }
    if (!$matched) json_response(['error' => 'No encontramos una orden con ese número.'], 404);
    $status = (string)($matched['status'] ?? 'En proceso');
    $messages = [
        'Nueva' => 'Recibimos tu solicitud y un asesor dará seguimiento.',
        'Pendiente de pago' => 'La orden fue creada, pero el pago todavía no está confirmado.',
        'Pagada' => 'El pago fue confirmado y los productos quedaron apartados.',
        'Pagada - revisar inventario' => 'El pago fue confirmado y nuestro equipo está validando la disponibilidad.',
        'En preparación' => 'El almacén está preparando tu pedido.',
        'Despachada' => 'Tu pedido salió del almacén.',
        'Entregada' => 'La orden fue marcada como entregada.',
        'Cancelada' => 'La orden fue cancelada. Contáctanos si necesitas ayuda.',
    ];
    json_response([
        'folio' => (string)($matched['folio'] ?? $folio),
        'status' => $status,
        'paymentStatus' => (string)($matched['paymentStatus'] ?? ''),
        'inventoryStatus' => (string)($matched['inventoryStatus'] ?? ''),
        'message' => $messages[$status] ?? 'Tu orden está registrada y continúa en seguimiento.',
    ]);
} catch (Throwable $error) {
    json_response(['error' => $error->getMessage() ?: 'No se pudo consultar la orden.'], 400);
}
