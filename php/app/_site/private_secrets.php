<?php

declare(strict_types=1);

/**
 * Load platform-managed site secrets from the private area outside app/.
 *
 * @return array<string,mixed>
 */
function private_secrets(): array
{
    static $secrets = null;

    if (is_array($secrets)) {
        return $secrets;
    }

    $path = dirname(__DIR__, 2) . '/private/secrets.php';

    if (!is_file($path)) {
        $secrets = [];
        return $secrets;
    }

    $loaded = require $path;
    $secrets = is_array($loaded) ? $loaded : [];

    return $secrets;
}
