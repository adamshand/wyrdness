<?php

declare(strict_types=1);

const PREVIEW_COOKIE_NAME = 'kawhi_preview';

function preview_domain_suffix(): string
{
    return strtolower(trim((string) (getenv('KAWHI_PREVIEW_DOMAIN_SUFFIX') ?: 'preview.haume.nz'), '.'));
}

function site_domain_suffix(): string
{
    return strtolower(trim((string) (getenv('KAWHI_SITE_DOMAIN_SUFFIX') ?: 'sites.haume.nz'), '.'));
}

function preview_signing_key_for_site(): string
{
    $explicit = trim((string) getenv('KAWHI_PREVIEW_SIGNING_KEY'));
    if ($explicit !== '') {
        return $explicit;
    }

    return trim((string) getenv('KAWHI_INTERNAL_TOKEN'));
}

function preview_builder_base_url(): string
{
    return rtrim((string) (getenv('KAWHI_BUILDER_BASE_URL') ?: 'https://builder.app.haume.nz'), '/');
}

function preview_builder_origin_from_base_url(string $baseUrl): string
{
    $parts = parse_url($baseUrl);
    $scheme = strtolower(trim((string) ($parts['scheme'] ?? '')));
    $host = strtolower(trim((string) ($parts['host'] ?? '')));
    $port = isset($parts['port']) ? (int) ($parts['port']) : null;

    if ($scheme === '' || $host === '') {
        return 'https://builder.app.haume.nz';
    }

    $origin = $scheme . '://' . $host;
    if (is_int($port) && $port > 0) {
        $origin .= ':' . $port;
    }

    return $origin;
}

function preview_builder_origin(): string
{
    return preview_builder_origin_from_base_url(preview_builder_base_url());
}

function current_request_host(): string
{
    return strtolower(trim((string) ($_SERVER['HTTP_HOST'] ?? ''), '.'));
}

function request_uri_without_preview_token(string $requestUri, bool $includeFragment = false): string
{
    $parts = parse_url($requestUri);
    $path = is_string($parts['path'] ?? null) && $parts['path'] !== '' ? $parts['path'] : '/';
    $query = [];
    if (is_string($parts['query'] ?? null) && $parts['query'] !== '') {
        parse_str($parts['query'], $query);
        unset($query['kawhi_preview_token']);
    }

    $queryString = http_build_query($query);
    $fragment = $includeFragment && is_string($parts['fragment'] ?? null) && $parts['fragment'] !== ''
        ? '#' . $parts['fragment']
        : '';

    return $path . ($queryString !== '' ? '?' . $queryString : '') . $fragment;
}

function current_request_uri_without_preview_token(): string
{
    return request_uri_without_preview_token((string) ($_SERVER['REQUEST_URI'] ?? '/'), true);
}

function request_is_preview_host(?string $host = null): bool
{
    $host = strtolower(trim((string) ($host ?? current_request_host()), '.'));
    $suffix = preview_domain_suffix();

    return $host !== ''
        && $suffix !== ''
        && ($host === $suffix || str_ends_with($host, '.' . $suffix));
}

function preview_slug_from_host(?string $host = null): string
{
    $host = strtolower(trim((string) ($host ?? current_request_host()), '.'));
    $suffix = preview_domain_suffix();
    if (!request_is_preview_host($host) || $suffix === '') {
        return '';
    }

    if ($host === $suffix) {
        return '';
    }

    return (string) preg_replace('/\.$/', '', substr($host, 0, -strlen('.' . $suffix)));
}

function public_site_fallback_url(?string $host = null, ?string $requestUri = null): string
{
    $slug = preview_slug_from_host($host);
    $siteSuffix = site_domain_suffix();
    if ($slug === '' || $siteSuffix === '') {
        return '';
    }

    $uri = $requestUri !== null ? current_uri_without_token_from_string($requestUri) : current_request_uri_without_preview_token();
    return 'https://' . $slug . '.' . $siteSuffix . $uri;
}

function current_uri_without_token_from_string(string $requestUri): string
{
    return request_uri_without_preview_token($requestUri, false);
}

/** @return array{ok:bool,host?:string,exp?:int,error?:string} */
function decode_preview_token(string $token, string $signingKey, ?int $now = null): array
{
    $token = trim($token);
    if ($token === '' || !str_contains($token, '.')) {
        return ['ok' => false, 'error' => 'Missing preview token'];
    }

    [$body, $signature] = explode('.', $token, 2);
    $expected = hash_hmac('sha256', $body, $signingKey);
    if ($signature === '' || !hash_equals($expected, $signature)) {
        return ['ok' => false, 'error' => 'Invalid preview token signature'];
    }

    $json = base64_decode(strtr($body, '-_', '+/'), true);
    if (!is_string($json) || $json === '') {
        return ['ok' => false, 'error' => 'Invalid preview token body'];
    }

    $payload = json_decode($json, true);
    if (!is_array($payload)) {
        return ['ok' => false, 'error' => 'Invalid preview token payload'];
    }

    $host = strtolower(trim((string) ($payload['host'] ?? ''), '.'));
    $exp = (int) ($payload['exp'] ?? 0);
    $currentTime = $now ?? time();

    if ($host === '' || $exp <= 0) {
        return ['ok' => false, 'error' => 'Invalid preview token fields'];
    }

    if ($exp < $currentTime) {
        return ['ok' => false, 'error' => 'Preview token expired'];
    }

    return ['ok' => true, 'host' => $host, 'exp' => $exp];
}

function preview_request_is_secure(): bool
{
    $https = strtolower((string) ($_SERVER['HTTPS'] ?? ''));
    $forwarded = strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? ''));
    return ($https !== '' && $https !== 'off') || $forwarded === 'https';
}

function set_preview_access_cookie(string $token, int $expiresAt): void
{
    setcookie(PREVIEW_COOKIE_NAME, $token, [
        'expires' => $expiresAt,
        'path' => '/',
        'secure' => preview_request_is_secure(),
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}

function clear_preview_access_cookie(): void
{
    setcookie(PREVIEW_COOKIE_NAME, '', [
        'expires' => time() - 3600,
        'path' => '/',
        'secure' => preview_request_is_secure(),
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}

function preview_access_allowed_for_host(string $token, string $host, ?int $now = null): bool
{
    $signingKey = preview_signing_key_for_site();
    if ($signingKey === '') {
        return false;
    }

    $decoded = decode_preview_token($token, $signingKey, $now);
    return ($decoded['ok'] ?? false) === true
        && strtolower((string) ($decoded['host'] ?? '')) === strtolower(trim($host, '.'));
}

function preview_bridge_version(): string
{
    return '2026-03-31';
}

function preview_bridge_script_url(): string
{
    return preview_builder_base_url() . '/preview-bridge.js.php';
}

function render_preview_bridge_markup(string $builderOrigin): string
{
    $config = [
        'builder_origin' => preview_builder_origin_from_base_url($builderOrigin),
        'bridge_version' => preview_bridge_version(),
    ];

    $configJson = json_encode($config, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT);
    if (!is_string($configJson) || $configJson === '') {
        $configJson = '{"builder_origin":"https://builder.app.haume.nz","bridge_version":"' . preview_bridge_version() . '"}';
    }

    $scriptUrl = htmlspecialchars(preview_bridge_script_url(), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');

    return '<script>window.__KAWHI_PREVIEW_BRIDGE_CONFIG = ' . $configJson . ';</script>'
        . '<script src="' . $scriptUrl . '"></script>';
}

function preview_html_with_bridge(string $html, ?string $builderOrigin = null): string
{
    if (!request_is_preview_host() || !preview_access_allowed_for_host((string) ($_COOKIE[PREVIEW_COOKIE_NAME] ?? ''), current_request_host())) {
        return $html;
    }

    $bridge = render_preview_bridge_markup($builderOrigin ?? preview_builder_origin());
    if (str_contains($html, '</body>')) {
        return preg_replace('/<\/body>/i', $bridge . '</body>', $html, 1) ?: $html;
    }

    return $html . $bridge;
}

function start_preview_bridge_buffer(): void
{
    static $started = false;

    if (!request_is_preview_host() || $started) {
        return;
    }

    $started = true;
    $builderOrigin = preview_builder_origin();
    ob_start(static fn (string $html): string => preview_html_with_bridge($html, $builderOrigin));
}

function render_preview_forbidden_page(): never
{
    http_response_code(403);
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: private, no-store');

    $publicUrl = public_site_fallback_url();
    $message = 'Sorry, this preview page is not available right now.';
    $linkHtml = $publicUrl !== ''
        ? '<p>You might be looking for <a href="' . htmlspecialchars($publicUrl, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') . '">' . htmlspecialchars($publicUrl, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') . '</a></p>'
        : '';

    echo '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Preview unavailable</title>'
        . '<style>body{font-family:system-ui,sans-serif;background:#fafaf9;color:#1c1917;padding:2rem;line-height:1.5}main{max-width:42rem;margin:10vh auto;background:white;border:1px solid #e7e5e4;border-radius:16px;padding:1.25rem 1.25rem 1rem}h1{margin:0 0 .5rem;font-size:1.25rem}p{margin:.5rem 0}a{color:#0f766e}</style>'
        . '</head><body><main><h1>Preview unavailable</h1><p>' . htmlspecialchars($message, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') . '</p>' . $linkHtml . '</main></body></html>';
    exit;
}

function enforce_preview_access(): void
{
    $host = current_request_host();
    if (!request_is_preview_host($host)) {
        return;
    }

    $cookieToken = trim((string) ($_COOKIE[PREVIEW_COOKIE_NAME] ?? ''));
    if ($cookieToken !== '' && preview_access_allowed_for_host($cookieToken, $host)) {
        start_preview_bridge_buffer();
        return;
    }

    $queryToken = trim((string) ($_GET['kawhi_preview_token'] ?? ''));
    if ($queryToken !== '' && preview_access_allowed_for_host($queryToken, $host)) {
        $decoded = decode_preview_token($queryToken, preview_signing_key_for_site());
        set_preview_access_cookie($queryToken, (int) ($decoded['exp'] ?? (time() + 300)));
        $redirectUri = current_request_uri_without_preview_token();
        header('Cache-Control: private, no-store');
        header('Location: ' . ($redirectUri !== '' ? $redirectUri : '/'), true, 302);
        exit;
    }

    clear_preview_access_cookie();
    render_preview_forbidden_page();
}
