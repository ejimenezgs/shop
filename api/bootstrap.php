<?php
declare(strict_types=1);

const CG_STRIPE_API = 'https://api.stripe.com/v1';
const CG_FIREBASE_AUTH_API = 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword';
const CG_FIREBASE_BACKEND_EMAIL = 'stripe-backend@casaglick.com';

function json_response(array $payload, int $status = 200): never {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function require_method(string $method): void {
    if (strtoupper($_SERVER['REQUEST_METHOD'] ?? '') !== strtoupper($method)) {
        header('Allow: ' . strtoupper($method));
        json_response(['error' => 'Método no permitido.'], 405);
    }
}


function require_same_origin(array $config): void {
    $siteUrl = rtrim((string)($config['site_url'] ?? ''), '/');
    $expectedHost = strtolower((string)(parse_url($siteUrl, PHP_URL_HOST) ?? ''));
    if ($expectedHost === '') return;

    $origin = trim((string)($_SERVER['HTTP_ORIGIN'] ?? ''));
    $referer = trim((string)($_SERVER['HTTP_REFERER'] ?? ''));
    $source = $origin !== '' ? $origin : $referer;
    if ($source === '') return; // Some privacy tools omit both headers.

    $sourceHost = strtolower((string)(parse_url($source, PHP_URL_HOST) ?? ''));
    if ($sourceHost === '' || !hash_equals($expectedHost, $sourceHost)) {
        throw new RuntimeException('Origen no autorizado.');
    }
}

function read_json_body(): array {
    $raw = file_get_contents('php://input');
    $data = json_decode($raw ?: '', true);
    if (!is_array($data)) json_response(['error' => 'Solicitud JSON inválida.'], 400);
    return $data;
}

function load_private_config(): array {
    $candidates = [];
    $envPath = getenv('CASA_GLICK_PRIVATE_CONFIG');
    if ($envPath) $candidates[] = $envPath;
    $documentRoot = rtrim((string)($_SERVER['DOCUMENT_ROOT'] ?? ''), '/');
    if ($documentRoot !== '') {
        $home = dirname(dirname($documentRoot));
        $candidates[] = $home . '/private/casa-glick-shop.php';
        $candidates[] = dirname($documentRoot) . '/private/casa-glick-shop.php';
    }
    $candidates[] = dirname(__DIR__) . '/private-config.php'; // local-only fallback, gitignored

    foreach ($candidates as $path) {
        if ($path && is_file($path)) {
            $config = require $path;
            if (is_array($config)) return $config;
        }
    }
    throw new RuntimeException('Falta la configuración privada del servidor.');
}

function http_request(string $url, string $method = 'GET', array $headers = [], ?string $body = null): array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_TIMEOUT => 25,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_FOLLOWLOCATION => false,
    ]);
    if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    $response = curl_exec($ch);
    $error = curl_error($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    if ($response === false) throw new RuntimeException('Error de red: ' . $error);
    return [$status, $response];
}

function firebase_access_token(array $config): string {
    static $token = null;
    if ($token) return $token;

    $apiKey = trim((string)($config['firebase_web_api_key'] ?? ''));
    $email = strtolower(trim((string)($config['firebase_auth_email'] ?? '')));
    $password = (string)($config['firebase_auth_password'] ?? '');
    if ($apiKey === '' || $email === '' || $password === '') {
        throw new RuntimeException('Faltan las credenciales del usuario técnico de Firebase.');
    }
    if (!hash_equals(CG_FIREBASE_BACKEND_EMAIL, $email)) {
        throw new RuntimeException('El correo técnico de Firebase no coincide con el autorizado.');
    }

    [$status, $response] = http_request(
        CG_FIREBASE_AUTH_API . '?key=' . rawurlencode($apiKey),
        'POST',
        ['Content-Type: application/json'],
        json_encode([
            'email' => $email,
            'password' => $password,
            'returnSecureToken' => true,
        ], JSON_UNESCAPED_SLASHES)
    );
    $data = json_decode($response, true);
    if ($status !== 200 || empty($data['idToken'])) {
        $reason = (string)($data['error']['message'] ?? 'unknown_error');
        error_log('firebase-auth: ' . $reason);
        throw new RuntimeException('Firebase rechazó al usuario técnico.');
    }
    if (!hash_equals($email, strtolower((string)($data['email'] ?? '')))) {
        throw new RuntimeException('Firebase devolvió una identidad inesperada.');
    }
    $expectedUid = trim((string)($config['firebase_auth_uid'] ?? ''));
    if ($expectedUid !== '' && !hash_equals($expectedUid, (string)($data['localId'] ?? ''))) {
        throw new RuntimeException('El UID del usuario técnico no coincide con la configuración.');
    }
    return $token = (string)$data['idToken'];
}

function firestore_base(array $config): string {
    $projectId = rawurlencode((string)($config['firebase_project_id'] ?? ''));
    if (!$projectId) throw new RuntimeException('Falta firebase_project_id.');
    return "https://firestore.googleapis.com/v1/projects/{$projectId}/databases/(default)/documents";
}

function firestore_decode_value(array $value): mixed {
    if (array_key_exists('stringValue', $value)) return $value['stringValue'];
    if (array_key_exists('integerValue', $value)) return (int)$value['integerValue'];
    if (array_key_exists('doubleValue', $value)) return (float)$value['doubleValue'];
    if (array_key_exists('booleanValue', $value)) return (bool)$value['booleanValue'];
    if (array_key_exists('timestampValue', $value)) return $value['timestampValue'];
    if (array_key_exists('nullValue', $value)) return null;
    if (isset($value['arrayValue']['values'])) return array_map('firestore_decode_value', $value['arrayValue']['values']);
    if (isset($value['mapValue']['fields'])) return firestore_decode_fields($value['mapValue']['fields']);
    return null;
}

function firestore_decode_fields(array $fields): array {
    $decoded = [];
    foreach ($fields as $key => $value) $decoded[$key] = firestore_decode_value($value);
    return $decoded;
}

function firestore_encode_value(mixed $value): array {
    if ($value === null) return ['nullValue' => null];
    if (is_bool($value)) return ['booleanValue' => $value];
    if (is_int($value)) return ['integerValue' => (string)$value];
    if (is_float($value)) return ['doubleValue' => $value];
    if ($value instanceof DateTimeInterface) return ['timestampValue' => $value->format(DateTimeInterface::RFC3339_EXTENDED)];
    if (is_array($value)) {
        // JSON arrays such as Stripe's `tax_ids: []` decode to an empty PHP
        // array. Treat an empty array as a Firestore array; encoding it as a
        // map would serialize `fields` as [] instead of the required object.
        if ($value === []) return ['arrayValue' => ['values' => []]];
        $isList = array_is_list($value);
        if ($isList) return ['arrayValue' => ['values' => array_map('firestore_encode_value', $value)]];
        return ['mapValue' => ['fields' => firestore_encode_fields($value)]];
    }
    return ['stringValue' => (string)$value];
}

function firestore_encode_fields(array $data): array {
    $fields = [];
    foreach ($data as $key => $value) $fields[$key] = firestore_encode_value($value);
    return $fields;
}

function firestore_get(array $config, string $path): ?array {
    $url = firestore_base($config) . '/' . implode('/', array_map('rawurlencode', explode('/', trim($path, '/'))));
    [$status, $body] = http_request($url, 'GET', ['Authorization: Bearer ' . firebase_access_token($config)]);
    if ($status === 404) return null;
    if ($status !== 200) throw new RuntimeException('No se pudo leer Firestore.');
    $doc = json_decode($body, true);
    return firestore_decode_fields($doc['fields'] ?? []);
}

function firestore_list(array $config, string $collection, int $pageSize = 500): array {
    $baseUrl = firestore_base($config) . '/' . rawurlencode($collection);
    $result = [];
    $pageToken = '';
    do {
        $query = ['pageSize' => max(1, min(1000, $pageSize))];
        if ($pageToken !== '') $query['pageToken'] = $pageToken;
        [$status, $body] = http_request(
            $baseUrl . '?' . http_build_query($query),
            'GET',
            ['Authorization: Bearer ' . firebase_access_token($config)]
        );
        if ($status !== 200) throw new RuntimeException('No se pudo listar Firestore.');
        $payload = json_decode($body, true);
        if (!is_array($payload)) throw new RuntimeException('Firestore devolvió una lista inválida.');
        foreach (($payload['documents'] ?? []) as $doc) {
            $name = (string)($doc['name'] ?? '');
            $id = rawurldecode(substr($name, strrpos($name, '/') + 1));
            $result[] = ['id' => $id, 'data' => firestore_decode_fields($doc['fields'] ?? [])];
        }
        $pageToken = (string)($payload['nextPageToken'] ?? '');
    } while ($pageToken !== '');
    return $result;
}

function firestore_patch(array $config, string $path, array $fields): void {
    $segments = array_map('rawurlencode', explode('/', trim($path, '/')));
    $url = firestore_base($config) . '/' . implode('/', $segments);
    foreach (array_keys($fields) as $field) $url .= (str_contains($url, '?') ? '&' : '?') . 'updateMask.fieldPaths=' . rawurlencode($field);
    [$status, $body] = http_request(
        $url,
        'PATCH',
        ['Authorization: Bearer ' . firebase_access_token($config), 'Content-Type: application/json'],
        json_encode(['fields' => firestore_encode_fields($fields)])
    );
    if ($status < 200 || $status >= 300) throw new RuntimeException('No se pudo actualizar Firestore: ' . $body);
}



function firestore_document_name(array $config, string $path): string {
    $projectId = rawurlencode((string)($config['firebase_project_id'] ?? ''));
    if (!$projectId) throw new RuntimeException('Falta firebase_project_id.');
    $segments = implode('/', array_map('rawurlencode', explode('/', trim($path, '/'))));
    return "projects/{$projectId}/databases/(default)/documents/{$segments}";
}

function firestore_begin_transaction(array $config): string {
    $projectId = rawurlencode((string)($config['firebase_project_id'] ?? ''));
    $url = "https://firestore.googleapis.com/v1/projects/{$projectId}/databases/(default)/documents:beginTransaction";
    [$status, $body] = http_request($url, 'POST', [
        'Authorization: Bearer ' . firebase_access_token($config),
        'Content-Type: application/json'
    ], '{}');
    $data = json_decode($body, true);
    if ($status < 200 || $status >= 300 || empty($data['transaction'])) {
        throw new RuntimeException('No se pudo iniciar la transacción de inventario.');
    }
    return (string)$data['transaction'];
}

function firestore_batch_get_transaction(array $config, array $paths, string $transaction): array {
    $projectId = rawurlencode((string)($config['firebase_project_id'] ?? ''));
    $url = "https://firestore.googleapis.com/v1/projects/{$projectId}/databases/(default)/documents:batchGet";
    $documents = array_map(fn($path) => firestore_document_name($config, $path), $paths);
    [$status, $body] = http_request($url, 'POST', [
        'Authorization: Bearer ' . firebase_access_token($config),
        'Content-Type: application/json'
    ], json_encode(['documents' => $documents, 'transaction' => $transaction]));
    if ($status < 200 || $status >= 300) throw new RuntimeException('No se pudo leer la reserva de inventario.');
    $result = [];
    $decoded = json_decode($body, true);
    if (is_array($decoded) && array_is_list($decoded)) $rows = $decoded;
    elseif (is_array($decoded)) $rows = [$decoded];
    else {
        $rows = [];
        foreach (preg_split('/\r?\n/', trim($body)) as $line) {
            if ($line === '') continue;
            $row = json_decode($line, true);
            if (is_array($row)) $rows[] = $row;
        }
    }
    foreach ($rows as $row) {
        if (!empty($row['found']['name'])) {
            $name = (string)$row['found']['name'];
            $result[$name] = [
                'exists' => true,
                'data' => firestore_decode_fields($row['found']['fields'] ?? []),
                'updateTime' => (string)($row['found']['updateTime'] ?? '')
            ];
        } elseif (!empty($row['missing'])) {
            $result[(string)$row['missing']] = ['exists' => false, 'data' => [], 'updateTime' => ''];
        }
    }
    $mapped = [];
    foreach ($paths as $path) {
        $name = firestore_document_name($config, $path);
        $mapped[$path] = $result[$name] ?? ['exists' => false, 'data' => [], 'updateTime' => ''];
    }
    return $mapped;
}

function firestore_commit_transaction(array $config, string $transaction, array $writes): void {
    $projectId = rawurlencode((string)($config['firebase_project_id'] ?? ''));
    $url = "https://firestore.googleapis.com/v1/projects/{$projectId}/databases/(default)/documents:commit";
    [$status, $body] = http_request($url, 'POST', [
        'Authorization: Bearer ' . firebase_access_token($config),
        'Content-Type: application/json'
    ], json_encode(['writes' => $writes, 'transaction' => $transaction]));
    if ($status < 200 || $status >= 300) {
        $payload = json_decode($body, true);
        $message = $payload['error']['message'] ?? 'No se pudo guardar la reserva de inventario.';
        throw new RuntimeException($message);
    }
}

function firestore_update_write(array $config, string $path, array $fields, bool $exists): array {
    $write = [
        'update' => [
            'name' => firestore_document_name($config, $path),
            'fields' => firestore_encode_fields($fields),
        ],
    ];
    if (!$exists) $write['currentDocument'] = ['exists' => false];
    return $write;
}

function reservation_document_id(string $sku): string {
    $normalized = normalize_lookup_key($sku);
    if ($normalized === '') throw new RuntimeException('SKU inválido para reserva.');
    return $normalized;
}

function aggregate_order_items(array $items): array {
    $aggregated = [];
    foreach ($items as $item) {
        if (!is_array($item)) throw new RuntimeException('La orden contiene un producto inválido.');
        $sku = trim((string)($item['code'] ?? $item['sku'] ?? $item['id'] ?? ''));
        $key = normalize_lookup_key($sku);
        if ($key === '') throw new RuntimeException('La orden contiene un SKU inválido.');
        $quantity = (int)($item['quantity'] ?? 1);
        if ($quantity < 1 || $quantity > 99) throw new RuntimeException("Cantidad inválida para {$sku}.");
        if (!isset($aggregated[$key])) {
            $aggregated[$key] = $item;
            $aggregated[$key]['code'] = $sku;
            $aggregated[$key]['quantity'] = 0;
        }
        $aggregated[$key]['quantity'] += $quantity;
        if ($aggregated[$key]['quantity'] > 99) throw new RuntimeException("Cantidad inválida para {$sku}.");
    }
    return array_values($aggregated);
}

function inventory_snapshot(array $config): array {
    $inventory = fetch_inventory($config);
    $byCode = [];
    foreach ($inventory as $raw) {
        if (!is_array($raw)) continue;
        $code = product_code($raw);
        if ($code !== '') $byCode[normalize_lookup_key($code)] = [
            'code' => $code,
            'stock' => normalized_stock($raw),
            'name' => product_name($raw),
        ];
    }
    return $byCode;
}

function reserve_inventory_for_paid_order(array $config, string $orderId, array $items, string $eventId): array {
    if (!$items) throw new RuntimeException('La orden pagada no contiene productos para reservar.');
    $items = aggregate_order_items($items);
    $physical = inventory_snapshot($config);
    $orderPath = 'inventoryReservationOrders/' . $orderId;
    $skuPaths = [];
    foreach ($items as $item) {
        $sku = trim((string)($item['code'] ?? $item['sku'] ?? ''));
        if ($sku === '') throw new RuntimeException('La orden contiene un SKU inválido.');
        $skuPaths[$sku] = 'inventoryStockReservations/' . reservation_document_id($sku);
    }

    $attempts = 0;
    while (++$attempts <= 4) {
        $transaction = firestore_begin_transaction($config);
        try {
            $documents = firestore_batch_get_transaction($config, array_merge([$orderPath], array_values($skuPaths)), $transaction);
            $existingOrder = $documents[$orderPath] ?? ['exists' => false, 'data' => []];
            $existingStatus = (string)($existingOrder['data']['status'] ?? '');
            if (in_array($existingStatus, ['reserved', 'dispatched'], true)) {
                return ['status' => $existingStatus, 'idempotent' => true];
            }

            $writes = [];
            $reservedItems = [];
            foreach ($items as $item) {
                $sku = trim((string)($item['code'] ?? $item['sku'] ?? ''));
                $quantity = max(1, (int)($item['quantity'] ?? 1));
                $key = normalize_lookup_key($sku);
                if (!isset($physical[$key])) throw new RuntimeException("El producto {$sku} ya no existe en inventario.");
                $path = $skuPaths[$sku];
                $document = $documents[$path] ?? ['exists' => false, 'data' => []];
                $reservedBefore = max(0, (int)($document['data']['reservedQuantity'] ?? 0));
                $physicalStock = max(0, (int)$physical[$key]['stock']);
                $availableBefore = max(0, $physicalStock - $reservedBefore);
                if ($availableBefore < $quantity) {
                    throw new RuntimeException("No hay disponibilidad suficiente para reservar {$sku}.");
                }
                $reservedAfter = $reservedBefore + $quantity;
                $writes[] = firestore_update_write($config, $path, [
                    'sku' => $sku,
                    'reservedQuantity' => $reservedAfter,
                    'physicalStockAtReservation' => $physicalStock,
                    'availableStock' => max(0, $physicalStock - $reservedAfter),
                    'updatedAt' => new DateTimeImmutable('now', new DateTimeZone('UTC')),
                ], (bool)$document['exists']);
                $reservedItems[] = [
                    'sku' => $sku,
                    'quantity' => $quantity,
                    'physicalStockAtReservation' => $physicalStock,
                ];
            }

            $writes[] = firestore_update_write($config, $orderPath, [
                'orderId' => $orderId,
                'status' => 'reserved',
                'items' => $reservedItems,
                'stripeEventId' => $eventId,
                'reservedAt' => new DateTimeImmutable('now', new DateTimeZone('UTC')),
                'updatedAt' => new DateTimeImmutable('now', new DateTimeZone('UTC')),
            ], (bool)$existingOrder['exists']);
            firestore_commit_transaction($config, $transaction, $writes);
            return ['status' => 'reserved', 'items' => $reservedItems, 'idempotent' => false];
        } catch (Throwable $error) {
            if ($attempts >= 4 || !str_contains(strtolower($error->getMessage()), 'aborted')) throw $error;
            usleep(120000 * $attempts);
        }
    }
    throw new RuntimeException('No se pudo completar la reserva de inventario.');
}

function transition_inventory_reservation(array $config, string $orderId, string $targetStatus, string $reason = ''): array {
    if (!in_array($targetStatus, ['dispatched', 'released'], true)) throw new RuntimeException('Estado de reserva inválido.');
    $orderPath = 'inventoryReservationOrders/' . $orderId;
    $attempts = 0;
    while (++$attempts <= 4) {
        $transaction = firestore_begin_transaction($config);
        try {
            $initial = firestore_batch_get_transaction($config, [$orderPath], $transaction);
            $reservation = $initial[$orderPath] ?? ['exists' => false, 'data' => []];
            if (!$reservation['exists']) throw new RuntimeException('La orden no tiene una reserva activa.');
            $currentStatus = (string)($reservation['data']['status'] ?? '');
            if ($currentStatus === $targetStatus) return ['status' => $targetStatus, 'idempotent' => true];
            if ($currentStatus !== 'reserved') throw new RuntimeException('La reserva ya fue procesada.');
            $items = is_array($reservation['data']['items'] ?? null) ? $reservation['data']['items'] : [];
            $skuPaths = [];
            foreach ($items as $item) {
                $sku = trim((string)($item['sku'] ?? ''));
                $skuPaths[$sku] = 'inventoryStockReservations/' . reservation_document_id($sku);
            }
            $documents = firestore_batch_get_transaction($config, array_values($skuPaths), $transaction);
            $writes = [];
            foreach ($items as $item) {
                $sku = trim((string)($item['sku'] ?? ''));
                $quantity = max(1, (int)($item['quantity'] ?? 1));
                $path = $skuPaths[$sku];
                $document = $documents[$path] ?? ['exists' => false, 'data' => []];
                if (!$document['exists']) throw new RuntimeException("No existe el acumulado de reserva para {$sku}.");
                $reservedBefore = max(0, (int)($document['data']['reservedQuantity'] ?? 0));
                if ($reservedBefore < $quantity) throw new RuntimeException("La reserva acumulada de {$sku} es inconsistente.");
                $reservedAfter = max(0, $reservedBefore - $quantity);
                $fields = $document['data'];
                $fields['sku'] = $sku;
                $fields['reservedQuantity'] = $reservedAfter;
                $physicalSnapshot = max(0, (int)($fields['physicalStockAtReservation'] ?? 0));
                $fields['availableStock'] = max(0, $physicalSnapshot - $reservedAfter);
                $fields['updatedAt'] = new DateTimeImmutable('now', new DateTimeZone('UTC'));
                $writes[] = firestore_update_write($config, $path, $fields, (bool)$document['exists']);
            }
            $orderFields = $reservation['data'];
            $orderFields['status'] = $targetStatus;
            $orderFields['reason'] = $reason;
            $orderFields[$targetStatus === 'dispatched' ? 'dispatchedAt' : 'releasedAt'] = new DateTimeImmutable('now', new DateTimeZone('UTC'));
            $orderFields['updatedAt'] = new DateTimeImmutable('now', new DateTimeZone('UTC'));
            $writes[] = firestore_update_write($config, $orderPath, $orderFields, true);
            firestore_commit_transaction($config, $transaction, $writes);
            return ['status' => $targetStatus, 'idempotent' => false];
        } catch (Throwable $error) {
            if ($attempts >= 4 || !str_contains(strtolower($error->getMessage()), 'aborted')) throw $error;
            usleep(120000 * $attempts);
        }
    }
    throw new RuntimeException('No se pudo actualizar la reserva.');
}

function require_inventory_admin_token(array $config): void {
    $expected = trim((string)($config['inventory_admin_token'] ?? ''));
    $provided = trim((string)($_SERVER['HTTP_X_INVENTORY_ADMIN_TOKEN'] ?? ''));
    if ($expected === '' || $provided === '' || !hash_equals($expected, $provided)) {
        throw new RuntimeException('No autorizado para modificar reservas.');
    }
}

function stripe_request(array $config, string $path, array $params = [], string $method = 'POST', ?string $idempotencyKey = null): array {
    $secret = (string)($config['stripe_secret_key'] ?? '');
    if (!str_starts_with($secret, 'sk_test_') && !str_starts_with($secret, 'sk_live_')) throw new RuntimeException('Falta una clave secreta válida de Stripe.');
    $environment = strtolower(trim((string)($config['stripe_environment'] ?? 'test')));
    if ($environment === 'test' && !str_starts_with($secret, 'sk_test_')) {
        throw new RuntimeException('La configuración está en modo Sandbox y requiere una clave sk_test_.');
    }
    if ($environment === 'live' && !str_starts_with($secret, 'sk_live_')) {
        throw new RuntimeException('La configuración está en modo producción y requiere una clave sk_live_.');
    }
    $headers = ['Authorization: Bearer ' . $secret];
    $body = null;
    $url = CG_STRIPE_API . $path;
    if ($method === 'GET') {
        if ($params) $url .= '?' . http_build_query($params);
    } else {
        $headers[] = 'Content-Type: application/x-www-form-urlencoded';
        if ($idempotencyKey) $headers[] = 'Idempotency-Key: ' . $idempotencyKey;
        $body = http_build_query($params);
    }
    [$status, $response] = http_request($url, $method, $headers, $body);
    $data = json_decode($response, true);
    if ($status < 200 || $status >= 300) {
        $message = $data['error']['message'] ?? 'Stripe rechazó la solicitud.';
        throw new RuntimeException($message);
    }
    return is_array($data) ? $data : [];
}

function normalize_lookup_key(mixed $value): string {
    $text = iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', (string)$value) ?: (string)$value;
    return strtolower(preg_replace('/[^a-zA-Z0-9]/', '', $text));
}

function find_deep(mixed $source, array $keys): mixed {
    $wanted = array_map('normalize_lookup_key', $keys);
    $queue = [$source];
    while ($queue) {
        $current = array_shift($queue);
        if (!is_array($current)) continue;
        foreach ($current as $key => $value) {
            if (in_array(normalize_lookup_key($key), $wanted, true) && $value !== null && $value !== '') return $value;
        }
        foreach ($current as $value) if (is_array($value)) $queue[] = $value;
    }
    return null;
}

function parse_number(mixed $value): ?float {
    if (is_int($value) || is_float($value)) return is_finite((float)$value) ? (float)$value : null;
    if (is_bool($value) || $value === null || is_array($value)) return null;
    $text = trim((string)$value);
    if ($text === '') return null;
    $text = preg_replace('/\s+/', '', $text);
    $text = preg_replace('/[^0-9,.-]/', '', $text);
    if ($text === '') return null;
    $comma = strrpos($text, ',');
    $dot = strrpos($text, '.');
    if ($comma !== false && ($dot === false || $comma > $dot)) $text = str_replace('.', '', str_replace(',', '.', $text));
    else $text = str_replace(',', '', $text);
    return is_numeric($text) ? (float)$text : null;
}

function collect_entries(mixed $source, string $prefix = ''): array {
    $entries = [];
    if (!is_array($source)) return $entries;
    foreach ($source as $key => $value) {
        $path = $prefix === '' ? (string)$key : $prefix . '.' . $key;
        $entries[] = ['key' => normalize_lookup_key($key), 'path' => normalize_lookup_key($path), 'value' => $value];
        if (is_array($value)) $entries = array_merge($entries, collect_entries($value, $path));
    }
    return $entries;
}

function normalized_price(array $raw): array {
    $entries = collect_entries($raw);
    $first = function(array $patterns) use ($entries): ?float {
        foreach ($entries as $entry) {
            foreach ($patterns as $pattern) {
                if (preg_match($pattern, $entry['key']) || preg_match($pattern, $entry['path'])) {
                    $number = parse_number($entry['value']);
                    if ($number !== null) return $number;
                }
            }
        }
        return null;
    };
    $regular = $first(['/preciooriginal/', '/originalprice/', '/precioantes/', '/precioanterior/', '/previousprice/', '/preciolista/', '/listprice/', '/precioregular/', '/regularprice/', '/baseprice/', '/msrp/']);
    $promo = $first(['/preciopromocion/', '/promotionprice/', '/promoprice/', '/preciodescuento/', '/discountprice/', '/preciooferta/', '/saleprice/', '/preciofinal/', '/precioespecial/', '/specialprice/', '/currentprice/']);
    $fallback = parse_number(find_deep($raw, ['precio','price','precioVenta','precioPublico','precioActual','currentPrice','venta']));
    $price = $promo ?? $fallback ?? $regular;
    if ($regular !== null && $price !== null && $price < $regular) return ['price' => $price, 'originalPrice' => $regular];
    if ($promo !== null && $fallback !== null) return ['price' => min($promo, $fallback), 'originalPrice' => max($promo, $fallback)];
    return ['price' => $price, 'originalPrice' => null];
}

function normalized_stock(array $raw): int {
    $total = parse_number(find_deep($raw, [
        'disponible', 'stockDisponible', 'availableStock', 'stockTotal', 'totalStock',
        'existenciaTotal', 'totalExistencia', 'totalExistencias', 'existencias',
        'stock', 'cantidad', 'quantity', 'qty'
    ]));
    return max(0, (int)floor($total ?? 0));
}

function unwrap_inventory(mixed $payload): array {
    if (is_array($payload) && array_keys($payload) === range(0, count($payload) - 1)) return $payload;
    foreach (['productos','products','data','catalogo','items','result','results'] as $key) {
        if (isset($payload[$key]) && is_array($payload[$key])) return $payload[$key];
        if (isset($payload['data'][$key]) && is_array($payload['data'][$key])) return $payload['data'][$key];
    }
    return [];
}

function fetch_inventory(array $config): array {
    [$status, $body] = http_request((string)($config['inventory_url'] ?? ''), 'GET', ['Accept: application/json']);
    if ($status !== 200) throw new RuntimeException('El inventario no está disponible.');
    $payload = json_decode($body, true);
    if (!is_array($payload)) throw new RuntimeException('La respuesta del inventario no es válida.');
    return unwrap_inventory($payload);
}

function product_code(array $raw): string {
    return trim((string)(find_deep($raw, ['codigo','code','sku','clave','idProducto','productId','id']) ?? ''));
}

function product_name(array $raw): string {
    return trim((string)(find_deep($raw, ['nombre','name','titulo','title','descripcionCorta']) ?? 'Producto'));
}

function product_image(array $raw): ?string {
    $candidate = trim((string)(find_deep($raw, ['imagen','image','imageUrl','foto','photo']) ?? ''));
    if ($candidate === '' || strlen($candidate) > 2048) return null;
    if (!filter_var($candidate, FILTER_VALIDATE_URL)) return null;
    return strtolower((string)parse_url($candidate, PHP_URL_SCHEME)) === 'https' ? $candidate : null;
}

function override_matches(array $record, string $code): bool {
    $data = $record['data'];
    $candidates = [$record['id']];
    foreach (['code','codigo','sku','productId','productID','idProducto','inventoryId','codigoProducto','productCode','clave','itemCode','itemId','slug'] as $key) {
        if (isset($data[$key])) $candidates[] = $data[$key];
    }
    $needle = normalize_lookup_key($code);
    foreach ($candidates as $candidate) if (normalize_lookup_key($candidate) === $needle) return true;
    return false;
}

function validate_order_items(array $config, array $requestedItems): array {
    if (!$requestedItems || count($requestedItems) > 50) throw new RuntimeException('La bolsa no contiene productos válidos.');
    $requestedItems = aggregate_order_items($requestedItems);
    $inventory = fetch_inventory($config);
    $overrides = firestore_list($config, 'catalogProductOverrides');
    $reservationDocs = firestore_list($config, 'inventoryStockReservations');
    $reservedBySku = [];
    foreach ($reservationDocs as $record) {
        $sku = trim((string)($record['data']['sku'] ?? $record['id'] ?? ''));
        if ($sku !== '') $reservedBySku[normalize_lookup_key($sku)] = max(0, (int)($record['data']['reservedQuantity'] ?? 0));
    }
    $inventoryByCode = [];
    foreach ($inventory as $raw) {
        if (!is_array($raw)) continue;
        $code = product_code($raw);
        if ($code !== '') $inventoryByCode[normalize_lookup_key($code)] = $raw;
    }
    $validated = [];
    $totalCents = 0;
    foreach ($requestedItems as $item) {
        $code = trim((string)($item['code'] ?? $item['id'] ?? ''));
        $quantity = (int)($item['quantity'] ?? 1);
        $raw = $inventoryByCode[normalize_lookup_key($code)] ?? null;
        if (!$raw) throw new RuntimeException("El producto {$code} ya no existe.");
        $override = null;
        foreach ($overrides as $candidate) if (override_matches($candidate, $code)) { $override = $candidate['data']; break; }
        if (!$override || ($override['published'] ?? false) !== true) throw new RuntimeException("El producto {$code} no está disponible para compra.");
        $physicalStock = normalized_stock($raw);
        $reservedStock = max(0, (int)($reservedBySku[normalize_lookup_key($code)] ?? 0));
        $stock = max(0, $physicalStock - $reservedStock);
        if ($stock < $quantity) throw new RuntimeException("Stock disponible insuficiente para {$code}.");
        $prices = normalized_price($raw);
        $price = $prices['price'];
        if ($price === null || $price <= 0) throw new RuntimeException("El producto {$code} requiere cotización y no puede pagarse en Stripe.");
        $unitAmount = (int)round($price * 100);
        $name = trim((string)($override['displayName'] ?? '')) ?: product_name($raw);
        $validated[] = [
            'code' => $code,
            'name' => $name,
            'image' => product_image($raw),
            'quantity' => $quantity,
            'unitAmount' => $unitAmount,
            'stock' => $stock,
            'physicalStock' => $physicalStock,
            'reservedStock' => $reservedStock,
        ];
        $totalCents += $unitAmount * $quantity;
    }
    return ['items' => $validated, 'totalCents' => $totalCents];
}

function verify_stripe_signature(string $payload, string $header, string $secret, int $tolerance = 300): void {
    $timestamp = null;
    $signatures = [];
    foreach (explode(',', $header) as $part) {
        [$key, $value] = array_pad(explode('=', trim($part), 2), 2, '');
        if ($key === 't') $timestamp = (int)$value;
        if ($key === 'v1') $signatures[] = $value;
    }
    if (!$timestamp || abs(time() - $timestamp) > $tolerance) throw new RuntimeException('Firma de webhook expirada.');
    $expected = hash_hmac('sha256', $timestamp . '.' . $payload, $secret);
    foreach ($signatures as $signature) if (hash_equals($expected, $signature)) return;
    throw new RuntimeException('Firma de webhook inválida.');
}

const CG_BREVO_EMAIL_API = 'https://api.brevo.com/v3/smtp/email';

function html_escape(mixed $value): string {
    return htmlspecialchars((string)$value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function cg_money(mixed $value): string {
    return '$' . number_format((float)$value, 2, '.', ',') . ' MXN';
}

function brevo_settings(array $config): array {
    $settings = is_array($config['brevo'] ?? null) ? $config['brevo'] : [];
    if (empty($settings['enabled'])) {
        throw new RuntimeException('Brevo no está habilitado.');
    }
    $required = ['api_key', 'sender_name', 'sender_email', 'reply_to_email', 'internal_recipient'];
    foreach ($required as $field) {
        if (trim((string)($settings[$field] ?? '')) === '') {
            throw new RuntimeException('Falta la configuración de Brevo: ' . $field . '.');
        }
    }
    if (!filter_var((string)$settings['sender_email'], FILTER_VALIDATE_EMAIL)
        || !filter_var((string)$settings['reply_to_email'], FILTER_VALIDATE_EMAIL)
        || !filter_var((string)$settings['internal_recipient'], FILTER_VALIDATE_EMAIL)) {
        throw new RuntimeException('La configuración de correo de Brevo no es válida.');
    }
    return $settings;
}

function brevo_send_email(
    array $config,
    array $recipients,
    string $subject,
    string $htmlContent,
    string $textContent,
    array $tags = []
): string {
    $settings = brevo_settings($config);
    $to = [];
    foreach ($recipients as $recipient) {
        $email = trim((string)($recipient['email'] ?? ''));
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) continue;
        $entry = ['email' => $email];
        $name = trim((string)($recipient['name'] ?? ''));
        if ($name !== '') $entry['name'] = $name;
        $to[] = $entry;
    }
    if (!$to) throw new RuntimeException('No hay destinatarios válidos para Brevo.');

    $payload = [
        'sender' => [
            'name' => (string)$settings['sender_name'],
            'email' => (string)$settings['sender_email'],
        ],
        'to' => $to,
        'replyTo' => [
            'name' => (string)($settings['reply_to_name'] ?? $settings['sender_name']),
            'email' => (string)$settings['reply_to_email'],
        ],
        'subject' => $subject,
        'htmlContent' => $htmlContent,
        'textContent' => $textContent,
    ];
    if ($tags) $payload['tags'] = array_values(array_filter(array_map('strval', $tags)));

    [$status, $body] = http_request(
        CG_BREVO_EMAIL_API,
        'POST',
        [
            'Accept: application/json',
            'Content-Type: application/json',
            'api-key: ' . (string)$settings['api_key'],
        ],
        json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)
    );
    $decoded = json_decode($body, true);
    if ($status < 200 || $status >= 300) {
        $message = is_array($decoded) ? (string)($decoded['message'] ?? '') : '';
        throw new RuntimeException('Brevo rechazó el correo' . ($message !== '' ? ': ' . $message : '.'));
    }
    return (string)($decoded['messageId'] ?? '');
}

function order_items_email_rows(array $items): string {
    $rows = '';
    foreach ($items as $item) {
        if (!is_array($item)) continue;
        $name = trim((string)($item['name'] ?? $item['code'] ?? 'Producto Casa Glick'));
        $code = trim((string)($item['code'] ?? ''));
        $quantity = max(1, (int)($item['quantity'] ?? 1));
        $price = is_numeric($item['price'] ?? null) ? (float)$item['price'] : 0.0;
        $lineTotal = $price * $quantity;
        $rows .= '<tr>'
            . '<td style="padding:14px 0;border-bottom:1px solid #e8e5df;">'
            . '<strong style="display:block;color:#1d1d1b;font-size:14px;">' . html_escape($name) . '</strong>'
            . ($code !== '' ? '<span style="color:#777;font-size:12px;">' . html_escape($code) . '</span>' : '')
            . '</td>'
            . '<td style="padding:14px 8px;border-bottom:1px solid #e8e5df;text-align:center;color:#555;font-size:14px;">' . $quantity . '</td>'
            . '<td style="padding:14px 0;border-bottom:1px solid #e8e5df;text-align:right;color:#1d1d1b;font-size:14px;">' . html_escape(cg_money($lineTotal)) . '</td>'
            . '</tr>';
    }
    return $rows;
}

function order_items_text(array $items): string {
    $lines = [];
    foreach ($items as $item) {
        if (!is_array($item)) continue;
        $name = trim((string)($item['name'] ?? $item['code'] ?? 'Producto Casa Glick'));
        $quantity = max(1, (int)($item['quantity'] ?? 1));
        $price = is_numeric($item['price'] ?? null) ? (float)$item['price'] : 0.0;
        $lines[] = $quantity . ' x ' . $name . ' — ' . cg_money($price * $quantity);
    }
    return implode("\n", $lines);
}

function build_customer_order_email(array $config, array $order, string $orderId): array {
    $customer = is_array($order['customer'] ?? null) ? $order['customer'] : [];
    $items = is_array($order['items'] ?? null) ? $order['items'] : [];
    $name = trim((string)($customer['firstName'] ?? ''));
    if ($name === '') $name = trim((string)($customer['name'] ?? ''));
    if ($name === '') $name = 'cliente';
    $folio = trim((string)($order['folio'] ?? $orderId));
    $total = (float)($order['total'] ?? 0);
    $delivery = trim((string)($customer['delivery'] ?? 'Por confirmar'));
    $address = trim((string)($customer['address'] ?? ''));
    $postalCode = trim((string)($customer['postalCode'] ?? ''));
    $siteUrl = rtrim((string)($config['site_url'] ?? 'https://shop.casaglick.com'), '/');
    $orderUrl = $siteUrl . '/order.html?folio=' . rawurlencode($folio);

    $subject = 'Confirmación de compra ' . $folio . ' | Casa Glick';
    $html = '<!doctype html><html><body style="margin:0;background:#f4f2ee;font-family:Arial,Helvetica,sans-serif;color:#1d1d1b;">'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f2ee;padding:32px 12px;"><tr><td align="center">'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;background:#fff;border-collapse:collapse;">'
        . '<tr><td style="padding:34px 40px 18px;text-align:center;font-size:22px;letter-spacing:2px;font-weight:600;">CASA GLICK</td></tr>'
        . '<tr><td style="padding:10px 40px 34px;">'
        . '<p style="margin:0 0 10px;color:#777;font-size:12px;letter-spacing:1.4px;text-transform:uppercase;">Pago confirmado</p>'
        . '<h1 style="margin:0 0 18px;font-family:Georgia,serif;font-size:34px;font-weight:400;line-height:1.15;">Gracias por tu compra, ' . html_escape($name) . '.</h1>'
        . '<p style="margin:0 0 26px;color:#555;font-size:15px;line-height:1.7;">Recibimos correctamente tu pago. Nuestro equipo dará seguimiento a la preparación y entrega de tu pedido.</p>'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;background:#f7f6f3;">'
        . '<tr><td style="padding:16px 18px;color:#777;font-size:12px;text-transform:uppercase;">Orden</td><td style="padding:16px 18px;text-align:right;font-weight:600;">' . html_escape($folio) . '</td></tr>'
        . '<tr><td style="padding:0 18px 16px;color:#777;font-size:12px;text-transform:uppercase;">Entrega</td><td style="padding:0 18px 16px;text-align:right;">' . html_escape($delivery) . '</td></tr>'
        . ($postalCode !== '' ? '<tr><td style="padding:0 18px 16px;color:#777;font-size:12px;text-transform:uppercase;">Código postal</td><td style="padding:0 18px 16px;text-align:right;">' . html_escape($postalCode) . '</td></tr>' : '')
        . ($address !== '' ? '<tr><td style="padding:0 18px 16px;color:#777;font-size:12px;text-transform:uppercase;vertical-align:top;">Dirección</td><td style="padding:0 18px 16px;text-align:right;line-height:1.5;">' . html_escape($address) . '</td></tr>' : '')
        . '</table>'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">'
        . '<thead><tr><th style="padding:10px 0;text-align:left;color:#777;font-size:11px;text-transform:uppercase;border-bottom:1px solid #1d1d1b;">Producto</th><th style="padding:10px 8px;text-align:center;color:#777;font-size:11px;text-transform:uppercase;border-bottom:1px solid #1d1d1b;">Cant.</th><th style="padding:10px 0;text-align:right;color:#777;font-size:11px;text-transform:uppercase;border-bottom:1px solid #1d1d1b;">Importe</th></tr></thead>'
        . '<tbody>' . order_items_email_rows($items) . '</tbody>'
        . '<tfoot><tr><td colspan="2" style="padding:20px 0 0;font-weight:600;">Total pagado</td><td style="padding:20px 0 0;text-align:right;font-size:18px;font-weight:600;">' . html_escape(cg_money($total)) . '</td></tr></tfoot>'
        . '</table>'
        . '<div style="padding:30px 0 8px;text-align:center;"><a href="' . html_escape($orderUrl) . '" style="display:inline-block;background:#1d1d1b;color:#fff;text-decoration:none;padding:15px 28px;font-size:12px;letter-spacing:1px;text-transform:uppercase;">Consultar mi orden</a></div>'
        . '<p style="margin:24px 0 0;color:#777;font-size:12px;line-height:1.6;text-align:center;">¿Tienes alguna duda? Responde este correo o escríbenos a contacto@gruposegel.com.</p>'
        . '</td></tr></table></td></tr></table></body></html>';

    $text = "CASA GLICK\n\nGracias por tu compra, {$name}.\nTu pago fue confirmado correctamente.\n\n"
        . "Orden: {$folio}\nEntrega: {$delivery}\n"
        . ($postalCode !== '' ? "Código postal: {$postalCode}\n" : '')
        . ($address !== '' ? "Dirección: {$address}\n" : '')
        . "\nProductos:\n" . order_items_text($items)
        . "\n\nTotal pagado: " . cg_money($total)
        . "\n\nConsulta tu orden: {$orderUrl}\n";

    return ['subject' => $subject, 'html' => $html, 'text' => $text];
}

function build_internal_order_email(array $config, array $order, string $orderId): array {
    $customer = is_array($order['customer'] ?? null) ? $order['customer'] : [];
    $items = is_array($order['items'] ?? null) ? $order['items'] : [];
    $folio = trim((string)($order['folio'] ?? $orderId));
    $name = trim((string)($customer['name'] ?? 'Cliente'));
    $email = trim((string)($customer['email'] ?? ''));
    $phone = trim((string)($customer['phone'] ?? ''));
    $delivery = trim((string)($customer['delivery'] ?? 'Por confirmar'));
    $address = trim((string)($customer['address'] ?? ''));
    $postalCode = trim((string)($customer['postalCode'] ?? ''));
    $comments = trim((string)($customer['comments'] ?? ''));
    $total = (float)($order['total'] ?? 0);
    $siteUrl = rtrim((string)($config['site_url'] ?? 'https://shop.casaglick.com'), '/');
    $orderUrl = $siteUrl . '/order.html?folio=' . rawurlencode($folio);

    $subject = 'Nueva compra ' . $folio . ' | Casa Glick Shop';
    $html = '<!doctype html><html><body style="margin:0;background:#f4f2ee;font-family:Arial,Helvetica,sans-serif;color:#1d1d1b;">'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f2ee;padding:28px 12px;"><tr><td align="center">'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:720px;background:#fff;border-collapse:collapse;">'
        . '<tr><td style="padding:30px 36px 16px;text-align:center;font-size:20px;letter-spacing:2px;font-weight:600;">CASA GLICK</td></tr>'
        . '<tr><td style="padding:12px 36px 34px;">'
        . '<p style="margin:0 0 8px;color:#777;font-size:12px;text-transform:uppercase;letter-spacing:1.4px;">Nueva venta confirmada</p>'
        . '<h1 style="margin:0 0 22px;font-family:Georgia,serif;font-size:32px;font-weight:400;">' . html_escape($folio) . '</h1>'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f6f3;margin-bottom:24px;">'
        . '<tr><td style="padding:14px 18px;color:#777;font-size:12px;">CLIENTE</td><td style="padding:14px 18px;text-align:right;font-weight:600;">' . html_escape($name) . '</td></tr>'
        . '<tr><td style="padding:0 18px 14px;color:#777;font-size:12px;">CORREO</td><td style="padding:0 18px 14px;text-align:right;">' . html_escape($email) . '</td></tr>'
        . '<tr><td style="padding:0 18px 14px;color:#777;font-size:12px;">TELÉFONO</td><td style="padding:0 18px 14px;text-align:right;">' . html_escape($phone) . '</td></tr>'
        . '<tr><td style="padding:0 18px 14px;color:#777;font-size:12px;">ENTREGA</td><td style="padding:0 18px 14px;text-align:right;">' . html_escape($delivery) . '</td></tr>'
        . ($postalCode !== '' ? '<tr><td style="padding:0 18px 14px;color:#777;font-size:12px;">CÓDIGO POSTAL</td><td style="padding:0 18px 14px;text-align:right;">' . html_escape($postalCode) . '</td></tr>' : '')
        . ($address !== '' ? '<tr><td style="padding:0 18px 14px;color:#777;font-size:12px;vertical-align:top;">DIRECCIÓN</td><td style="padding:0 18px 14px;text-align:right;line-height:1.5;">' . html_escape($address) . '</td></tr>' : '')
        . ($comments !== '' ? '<tr><td style="padding:0 18px 14px;color:#777;font-size:12px;vertical-align:top;">COMENTARIOS</td><td style="padding:0 18px 14px;text-align:right;line-height:1.5;">' . html_escape($comments) . '</td></tr>' : '')
        . '</table>'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">'
        . '<thead><tr><th style="padding:10px 0;text-align:left;color:#777;font-size:11px;border-bottom:1px solid #1d1d1b;">PRODUCTO</th><th style="padding:10px 8px;text-align:center;color:#777;font-size:11px;border-bottom:1px solid #1d1d1b;">CANT.</th><th style="padding:10px 0;text-align:right;color:#777;font-size:11px;border-bottom:1px solid #1d1d1b;">IMPORTE</th></tr></thead>'
        . '<tbody>' . order_items_email_rows($items) . '</tbody>'
        . '<tfoot><tr><td colspan="2" style="padding:20px 0 0;font-weight:600;">Total pagado</td><td style="padding:20px 0 0;text-align:right;font-size:18px;font-weight:600;">' . html_escape(cg_money($total)) . '</td></tr></tfoot>'
        . '</table>'
        . '<div style="padding:28px 0 0;text-align:center;"><a href="' . html_escape($orderUrl) . '" style="display:inline-block;background:#1d1d1b;color:#fff;text-decoration:none;padding:14px 26px;font-size:12px;text-transform:uppercase;letter-spacing:1px;">Consultar orden</a></div>'
        . '</td></tr></table></td></tr></table></body></html>';

    $text = "NUEVA COMPRA CASA GLICK\n\nOrden: {$folio}\nCliente: {$name}\nCorreo: {$email}\nTeléfono: {$phone}\nEntrega: {$delivery}\n"
        . ($postalCode !== '' ? "Código postal: {$postalCode}\n" : '')
        . ($address !== '' ? "Dirección: {$address}\n" : '')
        . ($comments !== '' ? "Comentarios: {$comments}\n" : '')
        . "\nProductos:\n" . order_items_text($items)
        . "\n\nTotal: " . cg_money($total)
        . "\n\nConsultar orden: {$orderUrl}\n";

    return ['subject' => $subject, 'html' => $html, 'text' => $text];
}

function send_paid_order_emails(array $config, array $order, string $orderId): array {
    $customer = is_array($order['customer'] ?? null) ? $order['customer'] : [];
    $customerEmail = trim((string)($customer['email'] ?? ''));
    if (!filter_var($customerEmail, FILTER_VALIDATE_EMAIL)) {
        throw new RuntimeException('La orden no tiene un correo de cliente válido.');
    }
    $settings = brevo_settings($config);
    $customerMessage = build_customer_order_email($config, $order, $orderId);
    $internalMessage = build_internal_order_email($config, $order, $orderId);

    $customerId = brevo_send_email(
        $config,
        [['email' => $customerEmail, 'name' => (string)($customer['name'] ?? '')]],
        $customerMessage['subject'],
        $customerMessage['html'],
        $customerMessage['text'],
        ['order-confirmation', 'casa-glick-shop']
    );
    $internalId = brevo_send_email(
        $config,
        [['email' => (string)$settings['internal_recipient'], 'name' => 'Casa Glick']],
        $internalMessage['subject'],
        $internalMessage['html'],
        $internalMessage['text'],
        ['new-order', 'casa-glick-shop']
    );

    return [
        'customerMessageId' => $customerId,
        'internalMessageId' => $internalId,
    ];
}

function assisted_item_amount_label(array $item): string {
    $quantity = max(1, (int)($item['quantity'] ?? 1));
    $price = is_numeric($item['price'] ?? null) ? (float)$item['price'] : 0.0;
    return $price > 0 ? cg_money($price * $quantity) : 'Por cotizar';
}

function assisted_order_items_email_rows(array $items): string {
    $rows = '';
    foreach ($items as $item) {
        if (!is_array($item)) continue;
        $name = trim((string)($item['name'] ?? $item['code'] ?? 'Producto Casa Glick'));
        $code = trim((string)($item['code'] ?? ''));
        $quantity = max(1, (int)($item['quantity'] ?? 1));
        $rows .= '<tr>'
            . '<td style="padding:14px 0;border-bottom:1px solid #e8e5df;">'
            . '<strong style="display:block;color:#1d1d1b;font-size:14px;">' . html_escape($name) . '</strong>'
            . ($code !== '' ? '<span style="color:#777;font-size:12px;">' . html_escape($code) . '</span>' : '')
            . '</td>'
            . '<td style="padding:14px 8px;border-bottom:1px solid #e8e5df;text-align:center;color:#555;font-size:14px;">' . $quantity . '</td>'
            . '<td style="padding:14px 0;border-bottom:1px solid #e8e5df;text-align:right;color:#1d1d1b;font-size:14px;">' . html_escape(assisted_item_amount_label($item)) . '</td>'
            . '</tr>';
    }
    return $rows;
}

function assisted_order_items_text(array $items): string {
    $lines = [];
    foreach ($items as $item) {
        if (!is_array($item)) continue;
        $name = trim((string)($item['name'] ?? $item['code'] ?? 'Producto Casa Glick'));
        $quantity = max(1, (int)($item['quantity'] ?? 1));
        $lines[] = $quantity . ' x ' . $name . ' — ' . assisted_item_amount_label($item);
    }
    return implode("\n", $lines);
}

function build_assisted_whatsapp_url(array $order): string {
    $customer = is_array($order['customer'] ?? null) ? $order['customer'] : [];
    $items = is_array($order['items'] ?? null) ? $order['items'] : [];
    $folio = trim((string)($order['folio'] ?? ''));
    $total = (float)($order['total'] ?? 0);
    $lines = [];
    foreach ($items as $item) {
        if (!is_array($item)) continue;
        $quantity = max(1, (int)($item['quantity'] ?? 1));
        $name = trim((string)($item['name'] ?? 'Producto Casa Glick'));
        $code = trim((string)($item['code'] ?? ''));
        $label = assisted_item_amount_label($item);
        $lines[] = '• ' . $quantity . ' × ' . $name . ($code !== '' ? ' (' . $code . ')' : '') . ' — ' . $label;
    }
    $message = "Hola, generé la solicitud {$folio} en Casa Glick.\n\n"
        . implode("\n", $lines)
        . "\n\nTotal estimado: " . cg_money($total)
        . "\nEntrega: " . (string)($customer['delivery'] ?? 'Por confirmar')
        . "\nCódigo Postal: " . (string)($customer['postalCode'] ?? '');
    if (($customer['delivery'] ?? '') === 'Envío a domicilio' && trim((string)($customer['address'] ?? '')) !== '') {
        $message .= "\nDirección: " . trim((string)$customer['address']);
    }
    $message .= "\nCliente: " . (string)($customer['name'] ?? '')
        . "\nTeléfono: " . (string)($customer['phone'] ?? '');
    return 'https://wa.me/525513004665?text=' . rawurlencode($message);
}

function build_customer_assisted_order_email(array $config, array $order, string $orderId): array {
    $customer = is_array($order['customer'] ?? null) ? $order['customer'] : [];
    $items = is_array($order['items'] ?? null) ? $order['items'] : [];
    $name = trim((string)($customer['firstName'] ?? $customer['name'] ?? 'cliente')) ?: 'cliente';
    $folio = trim((string)($order['folio'] ?? $orderId));
    $total = (float)($order['total'] ?? 0);
    $delivery = trim((string)($customer['delivery'] ?? 'Por confirmar'));
    $address = trim((string)($customer['address'] ?? ''));
    $postalCode = trim((string)($customer['postalCode'] ?? ''));
    $whatsappUrl = build_assisted_whatsapp_url($order);
    $subject = 'Recibimos tu solicitud ' . $folio . ' | Casa Glick';

    $html = '<!doctype html><html><body style="margin:0;background:#f4f2ee;font-family:Arial,Helvetica,sans-serif;color:#1d1d1b;">'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f2ee;padding:32px 12px;"><tr><td align="center">'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;background:#fff;border-collapse:collapse;">'
        . '<tr><td style="padding:34px 40px 18px;text-align:center;font-size:22px;letter-spacing:2px;font-weight:600;">CASA GLICK</td></tr>'
        . '<tr><td style="padding:10px 40px 34px;">'
        . '<p style="margin:0 0 10px;color:#777;font-size:12px;letter-spacing:1.4px;text-transform:uppercase;">Solicitud recibida</p>'
        . '<h1 style="margin:0 0 18px;font-family:Georgia,serif;font-size:34px;font-weight:400;line-height:1.15;">Gracias, ' . html_escape($name) . '.</h1>'
        . '<p style="margin:0 0 20px;color:#555;font-size:15px;line-height:1.7;">Recibimos tu selección de productos. Continúa por WhatsApp para que un asesor confirme disponibilidad, entrega y forma de pago.</p>'
        . '<p style="margin:0 0 26px;padding:14px 16px;background:#f7f6f3;color:#6a6258;font-size:12px;line-height:1.6;">Esta solicitud todavía no representa una compra pagada ni una reserva definitiva de inventario.</p>'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;background:#f7f6f3;">'
        . '<tr><td style="padding:16px 18px;color:#777;font-size:12px;text-transform:uppercase;">Solicitud</td><td style="padding:16px 18px;text-align:right;font-weight:600;">' . html_escape($folio) . '</td></tr>'
        . '<tr><td style="padding:0 18px 16px;color:#777;font-size:12px;text-transform:uppercase;">Entrega</td><td style="padding:0 18px 16px;text-align:right;">' . html_escape($delivery) . '</td></tr>'
        . ($postalCode !== '' ? '<tr><td style="padding:0 18px 16px;color:#777;font-size:12px;text-transform:uppercase;">Código postal</td><td style="padding:0 18px 16px;text-align:right;">' . html_escape($postalCode) . '</td></tr>' : '')
        . ($address !== '' ? '<tr><td style="padding:0 18px 16px;color:#777;font-size:12px;text-transform:uppercase;vertical-align:top;">Dirección</td><td style="padding:0 18px 16px;text-align:right;line-height:1.5;">' . html_escape($address) . '</td></tr>' : '')
        . '</table>'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">'
        . '<thead><tr><th style="padding:10px 0;text-align:left;color:#777;font-size:11px;text-transform:uppercase;border-bottom:1px solid #1d1d1b;">Producto</th><th style="padding:10px 8px;text-align:center;color:#777;font-size:11px;text-transform:uppercase;border-bottom:1px solid #1d1d1b;">Cant.</th><th style="padding:10px 0;text-align:right;color:#777;font-size:11px;text-transform:uppercase;border-bottom:1px solid #1d1d1b;">Importe</th></tr></thead>'
        . '<tbody>' . assisted_order_items_email_rows($items) . '</tbody>'
        . '<tfoot><tr><td colspan="2" style="padding:20px 0 0;font-weight:600;">Total estimado</td><td style="padding:20px 0 0;text-align:right;font-size:18px;font-weight:600;">' . html_escape(cg_money($total)) . '</td></tr></tfoot>'
        . '</table>'
        . '<div style="padding:30px 0 8px;text-align:center;"><a href="' . html_escape($whatsappUrl) . '" style="display:inline-block;background:#1d1d1b;color:#fff;text-decoration:none;padding:15px 28px;font-size:12px;letter-spacing:1px;text-transform:uppercase;">Continuar por WhatsApp</a></div>'
        . '<p style="margin:24px 0 0;color:#777;font-size:12px;line-height:1.6;text-align:center;">También puedes responder este correo y te atenderemos desde contacto@gruposegel.com.</p>'
        . '</td></tr></table></td></tr></table></body></html>';

    $text = "CASA GLICK\n\nRecibimos tu solicitud, {$name}.\n"
        . "Continúa por WhatsApp para confirmar disponibilidad, entrega y forma de pago.\n"
        . "Esta solicitud aún no representa una compra pagada ni una reserva definitiva.\n\n"
        . "Solicitud: {$folio}\nEntrega: {$delivery}\n"
        . ($postalCode !== '' ? "Código postal: {$postalCode}\n" : '')
        . ($address !== '' ? "Dirección: {$address}\n" : '')
        . "\nProductos:\n" . assisted_order_items_text($items)
        . "\n\nTotal estimado: " . cg_money($total)
        . "\n\nContinuar por WhatsApp: {$whatsappUrl}\n";

    return ['subject' => $subject, 'html' => $html, 'text' => $text, 'whatsappUrl' => $whatsappUrl];
}

function build_internal_assisted_order_email(array $config, array $order, string $orderId): array {
    $customer = is_array($order['customer'] ?? null) ? $order['customer'] : [];
    $items = is_array($order['items'] ?? null) ? $order['items'] : [];
    $folio = trim((string)($order['folio'] ?? $orderId));
    $name = trim((string)($customer['name'] ?? 'Cliente'));
    $email = trim((string)($customer['email'] ?? ''));
    $phone = trim((string)($customer['phone'] ?? ''));
    $delivery = trim((string)($customer['delivery'] ?? 'Por confirmar'));
    $address = trim((string)($customer['address'] ?? ''));
    $comments = trim((string)($customer['comments'] ?? ''));
    $total = (float)($order['total'] ?? 0);
    $whatsappUrl = build_assisted_whatsapp_url($order);
    $subject = 'Nueva solicitud pendiente ' . $folio . ' | Casa Glick Shop';
    $html = '<!doctype html><html><body style="margin:0;background:#f4f2ee;font-family:Arial,Helvetica,sans-serif;color:#1d1d1b;">'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f2ee;padding:28px 12px;"><tr><td align="center">'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:720px;background:#fff;border-collapse:collapse;">'
        . '<tr><td style="padding:30px 36px 16px;text-align:center;font-size:20px;letter-spacing:2px;font-weight:600;">CASA GLICK</td></tr>'
        . '<tr><td style="padding:12px 36px 34px;">'
        . '<p style="margin:0 0 8px;color:#777;font-size:12px;text-transform:uppercase;letter-spacing:1.4px;">Solicitud por WhatsApp · pendiente de pago</p>'
        . '<h1 style="margin:0 0 22px;font-family:Georgia,serif;font-size:32px;font-weight:400;">' . html_escape($folio) . '</h1>'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f6f3;margin-bottom:24px;">'
        . '<tr><td style="padding:14px 18px;color:#777;font-size:12px;">CLIENTE</td><td style="padding:14px 18px;text-align:right;font-weight:600;">' . html_escape($name) . '</td></tr>'
        . '<tr><td style="padding:0 18px 14px;color:#777;font-size:12px;">CORREO</td><td style="padding:0 18px 14px;text-align:right;">' . html_escape($email) . '</td></tr>'
        . '<tr><td style="padding:0 18px 14px;color:#777;font-size:12px;">TELÉFONO</td><td style="padding:0 18px 14px;text-align:right;">' . html_escape($phone) . '</td></tr>'
        . '<tr><td style="padding:0 18px 14px;color:#777;font-size:12px;">ENTREGA</td><td style="padding:0 18px 14px;text-align:right;">' . html_escape($delivery) . '</td></tr>'
        . ($address !== '' ? '<tr><td style="padding:0 18px 14px;color:#777;font-size:12px;vertical-align:top;">DIRECCIÓN</td><td style="padding:0 18px 14px;text-align:right;line-height:1.5;">' . html_escape($address) . '</td></tr>' : '')
        . ($comments !== '' ? '<tr><td style="padding:0 18px 14px;color:#777;font-size:12px;vertical-align:top;">COMENTARIOS</td><td style="padding:0 18px 14px;text-align:right;line-height:1.5;">' . html_escape($comments) . '</td></tr>' : '')
        . '</table>'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">'
        . '<tbody>' . assisted_order_items_email_rows($items) . '</tbody>'
        . '<tfoot><tr><td colspan="2" style="padding:20px 0 0;font-weight:600;">Total estimado</td><td style="padding:20px 0 0;text-align:right;font-size:18px;font-weight:600;">' . html_escape(cg_money($total)) . '</td></tr></tfoot>'
        . '</table>'
        . '<div style="padding:28px 0 0;text-align:center;"><a href="' . html_escape($whatsappUrl) . '" style="display:inline-block;background:#1d1d1b;color:#fff;text-decoration:none;padding:14px 26px;font-size:12px;text-transform:uppercase;letter-spacing:1px;">Abrir conversación en WhatsApp</a></div>'
        . '</td></tr></table></td></tr></table></body></html>';
    $text = "NUEVA SOLICITUD CASA GLICK — PENDIENTE DE PAGO\n\nSolicitud: {$folio}\nCliente: {$name}\nCorreo: {$email}\nTeléfono: {$phone}\nEntrega: {$delivery}\n"
        . ($address !== '' ? "Dirección: {$address}\n" : '')
        . ($comments !== '' ? "Comentarios: {$comments}\n" : '')
        . "\nProductos:\n" . assisted_order_items_text($items)
        . "\n\nTotal estimado: " . cg_money($total)
        . "\n\nWhatsApp: {$whatsappUrl}\n";
    return ['subject' => $subject, 'html' => $html, 'text' => $text];
}

function send_assisted_order_emails(array $config, array $order, string $orderId): array {
    $customer = is_array($order['customer'] ?? null) ? $order['customer'] : [];
    $customerEmail = trim((string)($customer['email'] ?? ''));
    if (!filter_var($customerEmail, FILTER_VALIDATE_EMAIL)) {
        throw new RuntimeException('La solicitud no tiene un correo de cliente válido.');
    }
    $settings = brevo_settings($config);
    $customerMessage = build_customer_assisted_order_email($config, $order, $orderId);
    $internalMessage = build_internal_assisted_order_email($config, $order, $orderId);
    $customerId = brevo_send_email(
        $config,
        [['email' => $customerEmail, 'name' => (string)($customer['name'] ?? '')]],
        $customerMessage['subject'],
        $customerMessage['html'],
        $customerMessage['text'],
        ['assisted-order-request', 'casa-glick-shop']
    );
    $internalId = brevo_send_email(
        $config,
        [['email' => (string)$settings['internal_recipient'], 'name' => 'Casa Glick']],
        $internalMessage['subject'],
        $internalMessage['html'],
        $internalMessage['text'],
        ['assisted-order-internal', 'casa-glick-shop']
    );
    return [
        'customerMessageId' => $customerId,
        'internalMessageId' => $internalId,
        'whatsappUrl' => $customerMessage['whatsappUrl'],
    ];
}
