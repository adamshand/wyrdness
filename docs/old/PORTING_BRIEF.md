# WyrdWeb Kawhi Porting Brief

> Historical note: the Kawhi/PHP port is complete. Active runtime files now live under `app/public/`; the original SvelteKit code is under `v1/` for reference.

Goal: port WyrdWeb from SvelteKit to a buildless Kawhi/PHP tenant site.

Do not preserve Svelte. Use PHP only for initial HTML shell. Use vanilla JS modules for all signal/rendering logic.

No build step. No npm dependency required.

Primary behavior to preserve:
- fullscreen canvas orb
- no jitter
- no dangerous strobe
- 200-bit random samples
- starting-point search
- channel detection
- mode/sensitivity controls
- demo mode
- help/legend/debug panels
- keyboard shortcuts

Primary behavior to update during port:
- user-facing colors should follow Wyrd's official mapping:
  - red = parallel
  - amber = antiparallel
  - blue = stick together
  - green = Pearson
- keep directional sub-channel details in debug only
- baseline should become dim slow color wandering
- high-intensity/anomaly behavior should use safe pulse/ring, not strobe
- response speed remains future work

Actual implementation:
- `app/public/index.php` renders the shell
- `app/public/page.css` contains route-local styles
- `app/public/page.js` handles DOM, animation, controls, and rendering orchestration
- `app/public/signal-core.js` contains shared signal/math code
- `app/public/calibration.js` contains generated runtime calibration tables
