<?php

declare(strict_types=1);

/**
 * Load the site's non-secret settings and derive stable public URLs.
 *
 * @return array{
 *   name:string,
 *   domain:string,
 *   title:string,
 *   description:string,
 *   base_url:string,
 *   asset_base_url:string,
 *   cta_label:string,
 *   cta_href:string,
 *   navigation:list<array{href:string,label:string}>
 * }
 */
function site_config(): array
{
    $site = [
        'name' => 'WyrdWeb',
        'domain' => $_SERVER['HTTP_HOST'] ?? 'example.test',
        'title' => 'WyrdWeb',
        'description' => 'A browser-based Wyrd Light inspired random-signal orb for shared focus, meetings, and experiments.',
        'cta_label' => 'Open WyrdWeb',
        'cta_href' => '/',
        'navigation' => [
            ['href' => '/', 'label' => 'WyrdWeb'],
        ],
    ];

    $name = trim((string) ($site['name'] ?? 'Your Business'));
    $domain = trim((string) ($site['domain'] ?? ($_SERVER['HTTP_HOST'] ?? 'example.test')));
    $title = trim((string) ($site['title'] ?? $name));
    $description = trim((string) ($site['description'] ?? ''));
    $baseUrl = trim((string) ($site['base_url'] ?? site_base_url($domain)));
    $assetBaseUrl = trim((string) ($site['asset_base_url'] ?? ($baseUrl !== '' ? ($baseUrl . '/assets') : '/assets')));

    return [
        'name' => $name,
        'domain' => $domain,
        'title' => $title !== '' ? $title : $name,
        'description' => $description,
        'base_url' => $baseUrl,
        'asset_base_url' => $assetBaseUrl,
        'cta_label' => trim((string) ($site['cta_label'] ?? 'Start a conversation')),
        'cta_href' => trim((string) ($site['cta_href'] ?? 'mailto:hello@example.com')),
        'navigation' => normalize_navigation($site['navigation'] ?? []),
    ];
}

function site_base_url(string $domain): string
{
    $domain = trim($domain);
    if ($domain === '') {
        return '';
    }

    $https = strtolower((string) ($_SERVER['HTTPS'] ?? ''));
    $scheme = ($https !== '' && $https !== 'off') ? 'https' : 'http';

    return $scheme . '://' . $domain;
}

/**
 * @param mixed $items
 * @return list<array{href:string,label:string}>
 */
function normalize_navigation(mixed $items): array
{
    if (!is_array($items)) {
        return [];
    }

    $normalized = [];

    foreach ($items as $item) {
        if (!is_array($item)) {
            continue;
        }

        $href = trim((string) ($item['href'] ?? ''));
        $label = trim((string) ($item['label'] ?? ''));
        if ($href === '' || $label === '') {
            continue;
        }

        $normalized[] = [
            'href' => $href,
            'label' => $label,
        ];
    }

    return $normalized;
}

/**
 * @param array{asset_base_url?:string} $site
 */
function site_asset_url(array $site, string $path): string
{
    $base = trim((string) ($site['asset_base_url'] ?? '/assets'));
    $path = ltrim($path, '/');

    if ($base === '') {
        return '/assets/' . $path;
    }

    return rtrim($base, '/') . '/' . $path;
}
