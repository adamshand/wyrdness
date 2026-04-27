<?php

declare(strict_types=1);
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title><?php echo escape_html($pageTitle); ?></title>
    <meta name="description" content="<?php echo escape_html($pageDescription); ?>">
    <link rel="stylesheet" href="<?php echo escape_html(scaffold_dependency_asset_url($site, 'open-props', 'open-props.min.css')); ?>">
    <link rel="stylesheet" href="<?php echo escape_html(asset_url($site, 'base.css')); ?>">
    <?php if (is_string($pageCssUrl) && $pageCssUrl !== ''): ?>
        <link rel="stylesheet" href="<?php echo escape_html($pageCssUrl); ?>">
    <?php endif; ?>
    <script src="<?php echo escape_html(scaffold_dependency_asset_url($site, 'htmx', 'htmx.min.js')); ?>" defer></script>
    <?php if (is_string($pageJsUrl) && $pageJsUrl !== ''): ?>
        <script src="<?php echo escape_html($pageJsUrl); ?>" defer></script>
    <?php endif; ?>
</head>
<body class="<?php echo escape_html($bodyClass); ?>">
<div class="site-shell">
    <header class="site-header panel">
        <div class="site-brand stack-tight">
            <a class="site-name" href="<?php echo escape_html(public_url($site, '/')); ?>"><?php echo escape_html((string) ($site['name'] ?? 'Site')); ?></a>
            <p class="site-domain"><?php echo escape_html((string) ($site['domain'] ?? '')); ?></p>
        </div>
        <nav class="site-nav" aria-label="Primary">
            <?php foreach (($site['navigation'] ?? []) as $item): ?>
                <a href="<?php echo escape_html((string) ($item['href'] ?? '/')); ?>">
                    <?php echo escape_html((string) ($item['label'] ?? 'Link')); ?>
                </a>
            <?php endforeach; ?>
        </nav>
    </header>

    <main class="page-main">
        <?php echo $content; ?>
    </main>

    <footer class="site-footer panel stack-tight">
        <p><?php echo escape_html((string) ($site['title'] ?? $site['name'] ?? 'Site')); ?></p>
        <p><?php echo escape_html((string) ($site['description'] ?? '')); ?></p>
    </footer>
</div>
</body>
</html>
