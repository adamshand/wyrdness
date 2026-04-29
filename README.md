<img width="360"  alt="image" src="https://github.com/user-attachments/assets/89431d98-d1f8-41b4-9f26-c0a202a11bbf" />

# What Is This?

The Wyrdness is a reverse engineered, hybrid implementation of the [Wyrd Light](https://gowyrd.org/wyrd-light/) and [Wyrdoscope](https://gowyrd.org/wyrdoscope-device/).

Try it here: https://wyrdness.adam.nz/

> Based on decades of international research, including 28 years of experiments run at the Princeton Engineering Anomalies Research Lab, there is hard evidence that human intention and group experience impact random data streams through what has been coined “the consciousness field”. [This is] an invisible, subtle field (more like gravitational or electromagnetic field but also distinctly different from these), in which we all interact.
>
> An analogy here would be to imagine you have static on an old TV. When you pay attention to it you start to see patterns within it. Then find these patterns are indeed, objectively there. Essentially, this implies that humans, through consciousness, are able to influence probabilities (random data) through non-physical means.
>
> https://gowyrd.org/faq/

Wyrdness app takes two streams of random numbers (zeros and ones) and monitors them for trends that deviate from expected randomness (eg. they start matching each other). It can be displayed on a large TV or screen shared on a video conference, providing groups with an easy and fun way to experiment with collective intention and receive immediate, visual feedback on the session.

Patterns of non-random behaviour are represented as a moving, shimmering orb of light. Different colours are used to represent patterns of behaviour. 

## Orb Colours:

- ⚫️ Baseline: no pattern is strong enough to dominate; should remain dim and slowly wander through colours
- 🔴 Parallel / correlated: the two streams drift in the same direction
- 🟠 Antiparallel / diverging: the two streams drift in opposite directions
- 🔵 Stick together: the two streams follow unusually similar paths
- 🟢 Pearson: Pearson correlation becomes the dominant pattern

Brightness tracks calibrated statistical unusualness (brighter = more unusual). Rare calibrated anomalies can trigger a single expanding white ring pulse; the pulse is intentionally separated from the smoothed brightness envelope so the orb can stay calm without hiding short rare events.

There are two main settings you can use to adjust the visual experience:

- **Mode (wow / mellow)** affects how dynamic the visualisation is. Mellow is intended for longer, background use. Wow is intended for groups actively watching and experimenting.
- **Sensitivity (conservative / moderate / engaging)** affects how statistically significant an event must be. These labels map roughly to Wyrd's Advanced / Intermediate / Beginner levels.

## Feedback 

if you use this and find it interesting or useful, I'd love hear from you. If you have suggestions for improvements please let me know.  

Go Wyrd suggests that the different colours may match to different group experiences.  But if, what, and how they match is still unknown. Pay attention and see what you can figure out! :-) 

[I look forward to hearing from you!](mailto:adam@shand.net?subject=Feedback%20on%20Wyrdness)

## Caveats

- This is pure AI vibe slop. I used Claude/Codex to reverse engineer the behaviour of the Wyrd Light from the limited information available on their website (see [WYRDLIGHT.md](docs/WYRDLIGHT.md)).
- The detector stack is empirically calibrated against simulated random data, but this is still an experimental reverse-engineered visualisation rather than a validated scientific instrument.
- Currently, the web app uses `crypto.getRandomValues()` to generate the streams of random numbers; this is not a quantum source and does not reproduce Wyrd's stored, previously unobserved quantum random data model.
- I'm still experimenting with visualisation and UI. Once that seems to be working well, I'll look at wiring up a quantum source.

## Background

Since reading Dean Radin's latest book, [The Science of Magic](https://www.penguin.co.nz/books/the-science-of-magic-9780593797587), I've been curious about psi phenomena. On his website he linked to Go Wyrd where I read about their [Wyrd Light](https://gowyrd.org/wyrd-light/) which uses stored sequences of quantum random numbers to visually display when statistically unlikely things are happening. Excited, I was going to buy one … and then I saw how much they cost. <sad face>

Disappointed, I started thinking about building something similar. A simple web app that takes two streams of random numbers, monitors them for divergence from randomness, and provides human friendly, visual feedback when unlikely things are happening.
