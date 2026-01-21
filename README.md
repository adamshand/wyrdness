<img width="988" height="1031" alt="image" src="https://github.com/user-attachments/assets/89431d98-d1f8-41b4-9f26-c0a202a11bbf" />

# Wyrdness

Wyrdness is a screen-shareable, web-based “lamp” inspired by the [Wyrd Light](https://gowyrd.org/wyrd-light/).

It takes two streams of random bits (0s and 1s), compares them once per second, and turns the detected patterns into a calm orb of color and light. The goal is not a dashboard or meter, but something you can leave on during a Zoom call and notice when it seems to “wake up”.

Key references:

- `WYRDLIGHT.md` — what we know (and don’t know) about the real device
- `src/routes/+page.svelte` — the whole engine (signal + visuals + HUD)

## What You’re Looking At

The orb has a few pattern “languages” it can detect:

- Correlated: both streams lean toward more 1s (↑) or more 0s (↓)
- Diverging: one stream leans toward 1s while the other leans toward 0s
- Agreement: the two streams match bit-by-bit more often than chance
- Pearson: the streams trend together (correlation as a dominant pattern)

Brightness is driven by statistical significance (low chance of being random). Between 1 Hz updates, everything is smoothed so it behaves like a physical object (no jitter, no strobing).

## Controls

- `?` toggle help
- `L` toggle legend
- `` ` `` toggle debug panel
- `M` toggle mode (Wow/Mellow)
- `1-5` set response speed
- `D` toggle demo mode
- `Escape` close modals / stop demo

## Dev

```bash
npm install
npm run dev
```

Other useful commands:

```bash
npm run check
npm run build
npm run preview
```

## Notes

Right now the “randomness” source is local (`crypto.getRandomValues()`). The code is structured so we can later feed it stored data or QRNG data without introducing visual jitter.
