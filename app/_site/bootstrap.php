<?php

declare(strict_types=1);

if (!defined('HAUME_SITE_ROOT')) {
    define('HAUME_SITE_ROOT', dirname(__DIR__, 2));
}

require_once __DIR__ . '/render.php';
require_once __DIR__ . '/request.php';
require_once __DIR__ . '/private_secrets.php';
require_once __DIR__ . '/site_private.php';
require_once __DIR__ . '/paths.php';
require_once __DIR__ . '/preview.php';
require_once __DIR__ . '/site_config.php';
require_once __DIR__ . '/validation.php';
require_once __DIR__ . '/sqlite.php';

$sharedRuntimeBootstrapCandidates = [
    dirname(__DIR__, 3) . '/_shared/runtime/bootstrap.php',
    dirname(__DIR__, 5) . '/sites/_shared/runtime/bootstrap.php',
];

foreach ($sharedRuntimeBootstrapCandidates as $candidate) {
    if (is_file($candidate)) {
        require_once $candidate;
        break;
    }
}

enforce_preview_access();
