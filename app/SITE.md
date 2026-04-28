# Kawhi Site Guide

This scaffold is designed to keep simple site work local and cheap for both people and agents.

## Default shape

```text
app/
  AGENTS.md             short agent-first guide
  SITE.md               longer human guide
  _site/
    bootstrap.php        shared setup for route entry files
    layout.php           shared outer page layout
    private_secrets.php  shared loader for /private/secrets.php
    site_private.php     shared loader for /private/site.php
    render.php           rendering helpers and sidecar detection
    request.php          request input helpers
    site_config.php      non-secret site settings and URL helpers
    sqlite.php           SQLite helper for app features
    validation.php       small validation helpers
  public/
    index.php            home page route
    page.css             optional sidecar for /
    assets/
      base.css           shared site-wide base styles
      vendor/
        open-props/...   local design tokens
        htmx/...         local htmx runtime
      images/            uploaded or hand-added images

private/
  secrets.php            platform-managed site secrets, outside builder sandbox
  site.php               platform-managed site facts readable by tenant runtime

storage/
  data/                  tenant-managed persistent data
  tmp/                   temp files
  logs/                  tenant runtime logs

versions/                builder-managed backups
```

Only files under `public/` are web-facing. Site secrets live in `/private/secrets.php`, not in `_site/` or `public/`.
Builder tools cannot list or read `/private/secrets.php`; runtime PHP code can load it.
Agents should read `AGENTS.md` first.

## Default rules

1. Start every PHP file with `declare(strict_types=1);`.
2. Treat each route folder as the default unit of work.
3. Keep simple page content in the route's `index.php`.
4. Add `page.css` or `page.js` beside a route only when that route needs them.
5. If a page gets large, split it into route-local `_partials/` before creating shared components.
6. If a route needs interaction, prefer htmx with a route-local handler such as `submit.php`.
7. Move code into `_site/components/` or `_site/lib/` only after it is genuinely reused.
8. Keep HTTP parsing and SQLite calls separate from business rules.
9. Never recreate secrets inside `app/`; load them from the platform-managed private area only when runtime code genuinely needs them.
10. Prefer the shared `_site/private_secrets.php` helper. If you must load secrets directly from a helper under `app/_site/`, use `dirname(__DIR__, 2) . '/private/secrets.php'`.

## Rendering contract

Route entrypoints should usually follow this pattern:

```php
$site = site_config();
$page = [
    'title' => 'Contact',
    'body_class' => 'contact-page',
];

ob_start();
?>
<section class="panel">...</section>
<?php
$content = (string) ob_get_clean();

render_page(__DIR__, $site, $page, $content);
```

`render_page(__DIR__, ...)` automatically includes route-local `page.css` and `page.js` when they exist.

## Secret loading

Use the shared helpers from `_site/bootstrap.php`:

```php
$secrets = private_secrets();
$smtpKey = $secrets['SMTP2GO_API_KEY'] ?? null;

$siteFacts = private_site();
$ownerEmail = $siteFacts['contact']['owner_email'] ?? null;
```

If a feature-specific helper needs to load the file itself, do it from `app/_site/...` with:

```php
$path = dirname(__DIR__, 2) . '/private/secrets.php';
$secrets = is_file($path) ? (require $path) : [];
```

Do not expect builder tools to reveal secret values, and do not copy secret values into files under `app/`.

## Shared runtime helpers

`_site/bootstrap.php` also loads the shared site runtime when available, so tenant pages can use:

```php
$images = haume()->images()->list(['tag_prefix' => 'gallery']);
$image = haume()->images()->get('/assets/images/hero.webp');
```

Image runtime reads are intentionally read-only and use canonical public paths like `/assets/images/...`.

## Growth path

- Small brochure site: edit `_site/site_config.php`, `public/index.php`, and `public/page.css`.
- Add a fixed route: create `public/<slug>/index.php`.
- Add dynamic route families, such as `/tags/<tag>` or `/gallery/<album>`: create `public/_router.php` and dispatch from the `route` query parameter Caddy passes internally. Physical files and fixed route folders still take precedence.
- Add route-local styling/behavior: create `public/<slug>/page.css` and `public/<slug>/page.js`.
- Add forms or interactive panels: use htmx with `public/<slug>/submit.php` and route-local partials.
- Real app behavior: move reusable rules into `_site/` only after the same code genuinely serves multiple routes.

## Runtime storage

- keep platform-managed site secrets in `/private/secrets.php`
- keep persistent tenant-managed data under `/storage/data`
- use `/storage/tmp` for temp files
- use `/storage/logs` for tenant runtime logs
- prefer `_site/paths.php` helpers such as `storage_data_path()` and `storage_logs_path()` over hand-written `dirname()` chains
- keep source code and assets in `app/`, not in `storage/`
