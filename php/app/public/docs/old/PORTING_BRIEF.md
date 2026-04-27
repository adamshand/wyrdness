# WyrdWeb Kawhi Porting Brief

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
- Stage 3 should use safe anomaly pulse/ring, not strobe
- response speed remains future work

Implementation target:
- index.php renders shell
- assets/wyrd.css contains styles
- assets/wyrd.js handles DOM, animation, controls
- assets/signal/*.js contains pure signal/math code
