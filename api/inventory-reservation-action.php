<?php
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';
require_method('POST');

try {
    $config = load_private_config();
    require_inventory_admin_token($config);
    $input = read_json_body();
    $orderId = trim((string)($input['orderId'] ?? ''));
    $action = trim((string)($input['action'] ?? ''));
    $reason = trim((string)($input['reason'] ?? ''));
    if (!preg_match('/^[A-Za-z0-9_-]{8,128}$/', $orderId)) throw new RuntimeException('Orden inválida.');
    if (!in_array($action, ['dispatch', 'release'], true)) throw new RuntimeException('Acción inválida.');

    $targetStatus = $action === 'dispatch' ? 'dispatched' : 'released';
    $result = transition_inventory_reservation($config, $orderId, $targetStatus, $reason);
    firestore_patch($config, 'orders/' . $orderId, [
        'inventoryStatus' => $targetStatus,
        'status' => $action === 'dispatch' ? 'Despachada' : 'Reserva liberada',
        $action === 'dispatch' ? 'dispatchedAt' : 'inventoryReleasedAt' => new DateTimeImmutable('now', new DateTimeZone('UTC')),
    ]);
    json_response(['ok' => true, 'orderId' => $orderId, 'inventoryStatus' => $result['status'], 'idempotent' => $result['idempotent'] ?? false]);
} catch (Throwable $error) {
    error_log('inventory-reservation-action: ' . $error->getMessage());
    json_response(['error' => $error->getMessage() ?: 'No se pudo actualizar la reserva.'], 400);
}
