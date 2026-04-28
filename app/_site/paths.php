<?php

declare(strict_types=1);

function site_root_path(string $suffix = ''): string
{
    return site_path_from_root('', $suffix);
}

function storage_data_path(string $suffix = ''): string
{
    return site_path_from_root('storage/data', $suffix);
}

function storage_tmp_path(string $suffix = ''): string
{
    return site_path_from_root('storage/tmp', $suffix);
}

function storage_logs_path(string $suffix = ''): string
{
    return site_path_from_root('storage/logs', $suffix);
}

function site_path_from_root(string $base, string $suffix = ''): string
{
    $root = dirname(__DIR__, 2);
    $segments = [];

    foreach ([$base, $suffix] as $part) {
        $normalized = trim(str_replace('\\', '/', $part), '/');
        if ($normalized !== '') {
            $segments[] = $normalized;
        }
    }

    return $segments === [] ? $root : ($root . '/' . implode('/', $segments));
}
