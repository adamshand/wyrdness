<?php

declare(strict_types=1);

function request_method(): string
{
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    return is_string($method) ? strtoupper($method) : 'GET';
}

function request_string(array $source, string $key): ?string
{
    $value = $source[$key] ?? null;

    if (!is_string($value)) {
        return null;
    }

    $trimmed = trim($value);

    return $trimmed === '' ? null : $trimmed;
}

/**
 * @return array<string,mixed>
 */
function request_json_body(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || trim($raw) === '') {
        return [];
    }

    $decoded = json_decode($raw, true);

    return is_array($decoded) ? $decoded : [];
}
