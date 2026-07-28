<?php
declare(strict_types=1);

const CG_STRIPE_API = 'https://api.stripe.com/v1';
const CG_FIRESTORE_SCOPE = 'https://www.googleapis.com/auth/datastore';

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

function base64url_encode(string $data): string {
    return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
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

function firebase_service_account(array $config): array {
    if (!empty($config['firebase_service_account']) && is_array($config['firebase_service_account'])) {
        return $config['firebase_service_account'];
    }
    $path = (string)($config['firebase_service_account_path'] ?? '');
    if (!$path || !is_file($path)) throw new RuntimeException('Falta la cuenta de servicio de Firebase.');
    $data = json_decode((string)file_get_contents($path), true);
    if (!is_array($data)) throw new RuntimeException('La cuenta de servicio de Firebase no es válida.');
    return $data;
}

function firebase_access_token(array $config): string {
    static $token = null;
    if ($token) return $token;
    $service = firebase_service_account($config);
    $now = time();
    $header = base64url_encode(json_encode(['alg' => 'RS256', 'typ' => 'JWT']));
    $claims = base64url_encode(json_encode([
        'iss' => $service['client_email'],
        'scope' => CG_FIRESTORE_SCOPE,
        'aud' => 'https://oauth2.googleapis.com/token',
        'iat' => $now,
        'exp' => $now + 3500,
    ]));
    $unsigned = $header . '.' . $claims;
    $signature = '';
    if (!openssl_sign($unsigned, $signature, $service['private_key'], OPENSSL_ALGO_SHA256)) {
        throw new RuntimeException('No se pudo firmar la autenticación de Firebase.');
    }
    $jwt = $unsigned . '.' . base64url_encode($signature);
    [$status, $response] = http_request(
        'https://oauth2.googleapis.com/token',
        'POST',
        ['Content-Type: application/x-www-form-urlencoded'],
        http_build_query([
            'grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            'assertion' => $jwt,
        ])
    );
    $data = json_decode($response, true);
    if ($status !== 200 || empty($data['access_token'])) throw new RuntimeException('Firebase rechazó la cuenta de servicio.');
    return $token = $data['access_token'];
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
        $isList = array_keys($value) === range(0, count($value) - 1);
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
