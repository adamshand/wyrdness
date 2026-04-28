<?php

declare(strict_types=1);

function is_blank(?string $value): bool
{
    return $value === null || trim($value) === '';
}

function normalize_email(?string $value): ?string
{
    if (is_blank($value)) {
        return null;
    }

    $normalized = filter_var(trim((string) $value), FILTER_VALIDATE_EMAIL);

    return is_string($normalized) ? strtolower($normalized) : null;
}

/**
 * @param array<string,?string> $fields
 * @return list<string>
 */
function missing_required_fields(array $fields): array
{
    $missing = [];

    foreach ($fields as $name => $value) {
        if (is_blank($value)) {
            $missing[] = $name;
        }
    }

    return $missing;
}
