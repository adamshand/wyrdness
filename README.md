<img width="360"  alt="image" src="https://github.com/user-attachments/assets/89431d98-d1f8-41b4-9f26-c0a202a11bbf" />

# What Is This?

The Wyrd Web is a reverse engineered, hybrid implementation of the [Wyrd Light](https://gowyrd.org/wyrd-light/) and [Wyrdoscope](https://gowyrd.org/wyrdoscope-device/).

Try it here: https://wyrdweb.adam.nz/

> Based on decades of international research, including 28 years of experiments run at the Princeton Engineering Anomalies Research Lab, there is hard evidence that human intention and group experience impact random data streams through what has been coined “the consciousness field”. [This is] an invisible, subtle field (more like gravitational or electromagnetic field but also distinctly different from these), in which we all interact.
>
> An analogy here would be to imagine you have static on an old TV. When you pay attention to it you start to see patterns within it. Then find these patterns are indeed, objectively there. Essentially, this implies that humans, through consciousness, are able to influence probabilities (random data) through non-physical means.
>
> https://gowyrd.org/faq/

The Wyrd Web app takes two streams of random numbers (zeros and ones) and monitors them for trends that deviate from expected randomness (eg. they start matching each other). It can be displayed on a large TV or screen shared on a video conference, providing groups with an easy and fun way to experiment with collective intention and receive immediate, visual feedback on their efforts.

Non-random, statistical patterns are represented as a moving, shimmering orb of light. The suggestion from the Wyrdo's is that different patterns represent different group experiences. We don't yet know how to map or generate them. In theory, groups should be able to learn how to deliberately make the orb change color and rotation.

Orb Colors:

- ⚫️ Baseline: no pattern is strong enough to dominate 
- 🔵 Correlated: both streams drift the same way - more 1s (↑) or more 0s (↓)
- 🟡🔴 Diverging: streams drift in opposite directions - A high/B low (←) or B high/A low (→)
- 🟢 Agreement: bit-by-bit matches are higher than expected by chance
- 🟣 Pearson: correlation becomes the dominant pattern (a "pearly" look)

Brightness tracks overall statistical significance. When it crosses a threshold, you'll see an expanding white ring pulse.

The Pearson swirl is separate from the dominant color: when correlation is strong enough, the orb develops a rotating swirl. It spins clockwise for positive correlation (+) and counterclockwise for negative (-).  This can happen alongside any other pattern.

There are two settings you can use to adjust the visual experience:

- **Mode (wow / mellow)** affects how dynamic the visualisation is. Mellow might be suitable longer, background uses. Wow might be suitable if you are actively watching and experimenting.
- **Sensitivity (conservative / moderate / engaging)** affects how statistically significant an event must be. In *conservative* mode an event will occur approximately every ten minutes, in *moderate* every three minutes, and in *engaging* every minute.

Your mission, should you choose to accept it, is to figure out how to control the patterns. 🤯 🦄 🤣

As always, feedback is welcome. 💬

# Caveats

- This is my first vibe coded app. I used Claude/ChatGPT to attempt to reverse engineer what the Wryd Light does from the limited information on their website (see [WYRDLIGHT.md](WYRDLIGHT.md)).
- The math involved is beyond my expertise, so I can't validate the AI implementation.
- Currently, the web app uses `crypto.getRandomValues()` to generate the streams of random numbers; this is not a quantum source.
- I'm still experimenting with visualisation and UI. Once that seems to be working well, I'll look at wiring up a quantum source.

# Background

Since reading Dean Radin's latest book, The Science of Magic, I've been curious about psi phenomena. On his website, he linked to Go Wyrd and I read about their [Wyrd Light](https://gowyrd.org/wyrd-light/) which uses stored sequences of quantum random numbers to visually display when statistically unlikely things are happening. Excited, I was going to buy one … and then I saw how much they cost.

Disappointed, I started thinking about building something similar. A simple web app that takes two streams of random numbers, monitors them for divergence from randomness, and provides human friendly, visual feedback when unlikely things are happening.
