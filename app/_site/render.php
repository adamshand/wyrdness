<?php

declare(strict_types=1);

const SCAFFOLD_OPEN_PROPS_VERSION = '1.7.6';
const SCAFFOLD_HTMX_VERSION = '2.0.4';

function escape_html(?string $value): string
{
    return htmlspecialchars($value ?? '', ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

/** @param array{asset_base_url?:string,base_url?:string} $site */
function asset_url(array $site, string $path): string
{
    return site_asset_url($site, $path);
}

/** @param array{base_url?:string} $site */
function public_url(array $site, string $path): string
{
    $path = '/' . ltrim($path, '/');
    $baseUrl = trim((string) ($site['base_url'] ?? ''));

    return $baseUrl === '' ? $path : rtrim($baseUrl, '/') . $path;
}

function page_title(array $site, array $page): string
{
    $pageTitle = trim((string) ($page['title'] ?? ''));
    $siteTitle = trim((string) ($site['title'] ?? 'Site'));

    if ($pageTitle === '') {
        return $siteTitle !== '' ? $siteTitle : 'Site';
    }

    if ($siteTitle === '' || $pageTitle === $siteTitle) {
        return $pageTitle;
    }

    return $pageTitle . ' | ' . $siteTitle;
}

function page_description(array $site, array $page): string
{
    $pageDescription = trim((string) ($page['description'] ?? ''));
    if ($pageDescription !== '') {
        return $pageDescription;
    }

    return trim((string) ($site['description'] ?? ''));
}

function join_classes(string ...$classes): string
{
    $normalized = [];

    foreach ($classes as $class) {
        $trimmed = trim($class);
        if ($trimmed === '') {
            continue;
        }

        $normalized[] = $trimmed;
    }

    return implode(' ', $normalized);
}

function scaffold_public_root(): string
{
    return dirname(__DIR__) . '/public';
}

function public_relative_path_for_file(string $publicRoot, string $routeDir, string $filename): ?string
{
    $resolvedPublicRoot = realpath($publicRoot);
    $resolvedRouteDir = realpath($routeDir);

    if (!is_string($resolvedPublicRoot) || !is_string($resolvedRouteDir)) {
        return null;
    }

    $sidecarPath = $resolvedRouteDir . '/' . $filename;
    if (!is_file($sidecarPath)) {
        return null;
    }

    $publicPrefix = rtrim(str_replace('\\', '/', $resolvedPublicRoot), '/');
    $routePrefix = rtrim(str_replace('\\', '/', $resolvedRouteDir), '/');

    if ($routePrefix !== $publicPrefix && !str_starts_with($routePrefix, $publicPrefix . '/')) {
        return null;
    }

    $relativeDir = ltrim(substr($routePrefix, strlen($publicPrefix)), '/');

    return $relativeDir === '' ? $filename : $relativeDir . '/' . $filename;
}

function route_sidecar_public_path(string $routeDir, string $filename): ?string
{
    return public_relative_path_for_file(scaffold_public_root(), $routeDir, $filename);
}

/** @param array{base_url?:string} $site */
function route_asset_url(array $site, string $routeDir, string $filename): ?string
{
    $relativePath = route_sidecar_public_path($routeDir, $filename);
    if (!is_string($relativePath) || $relativePath === '') {
        return null;
    }

    return public_url($site, $relativePath);
}

/** @return array<string,string> */
function scaffold_dependency_versions(): array
{
    return [
        'open-props' => SCAFFOLD_OPEN_PROPS_VERSION,
        'htmx' => SCAFFOLD_HTMX_VERSION,
    ];
}

function scaffold_dependency_asset_path(string $package, string $filename): string
{
    $versions = scaffold_dependency_versions();
    $version = $versions[$package] ?? null;

    if (!is_string($version) || $version === '') {
        throw new RuntimeException('Unknown scaffold dependency: ' . $package);
    }

    return 'vendor/' . $package . '/' . $version . '/' . $filename;
}

/** @param array{asset_base_url?:string,base_url?:string} $site */
function scaffold_dependency_asset_url(array $site, string $package, string $filename): string
{
    return asset_url($site, scaffold_dependency_asset_path($package, $filename));
}

/**
 * @param array<string,mixed> $site
 * @param array<string,mixed> $page
 */
function render_page(string $routeDir, array $site, array $page, string $content): void
{
    $pageTitle = page_title($site, $page);
    $pageDescription = page_description($site, $page);
    $bodyClass = join_classes('site-page', (string) ($page['body_class'] ?? ''));
    $pageCssUrl = route_asset_url($site, $routeDir, 'page.css');
    $signalCoreJsUrl = route_asset_url($site, $routeDir, 'signal-core.js');
    $calibrationJsUrl = route_asset_url($site, $routeDir, 'calibration.js');
    $pageJsUrl = route_asset_url($site, $routeDir, 'page.js');

    require __DIR__ . '/layout.php';
}
