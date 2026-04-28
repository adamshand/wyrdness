# Kawhi Site Agent Guide

Read this first.

## Defaults

- New fixed routes live at `public/<slug>/index.php`.
- Dynamic route families, such as `/tags/<tag>` or `/gallery/<album>`, can use `public/_router.php` instead of one folder per dynamic value.
- Route-local `page.css` and `page.js` auto-load when present.
- Keep simple page content in the route file.
- If a route gets large, split into route-local `_partials/`.
- If a route needs interaction, prefer a route-local htmx handler like `submit.php`.
- Reusable shared helpers live under `_site/` only after real reuse.
- Update navigation in `_site/site_config.php` when adding routes if it is not already handled for you.

## Good first reads

- `public/index.php`
- `public/page.css`
- `_site/site_config.php`
- `_site/layout.php`

## Uploaded images

- Uploaded files are usually available under `public/assets/images/`.
- Prefer the saved asset path over the original upload filename.
- Use `asset_url($site, 'images/<file>')` in scaffold templates.

## Runtime data

- Builder code tools only see files under `app/`.
- Live tenant runtime data is under `storage/data` outside the `app/` tool sandbox.
- Use dedicated runtime-data tools to inspect live files in `storage/data`.
- `read_runtime_data` automatically returns SQLite schema for database files in `storage/data`.
- Prefer `_site/paths.php` helpers like `storage_data_path()` instead of hand-written `dirname()` chains when runtime code needs storage paths.
- When implementing persistence, write runtime PHP that reads/writes `storage/data`; do not store mutable runtime data in `app/`.
- Platform-managed site facts readable by tenant runtime live in `private/site.php`; use `private_site()` from `_site/bootstrap.php` instead of loading that file manually.
- Shared read-only image helpers are available through `haume()->images()` and use canonical public paths like `/assets/images/...`.
