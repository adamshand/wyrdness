<?php

declare(strict_types=1);

/**
 * Load platform-managed site facts from the private area outside app/.
 *
 * @return array<string,mixed>
 */
function private_site(): array
{
    static $site = null;

    if (is_array($site)) {
        return $site;
    }

    $path = dirname(__DIR__, 2) . '/private/site.php';

    if (!is_file($path)) {
        $site = [];
        return $site;
    }

    $loaded = require $path;
    $site = is_array($loaded) ? $loaded : [];

    return $site;
}
