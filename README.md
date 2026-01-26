<img width="360"  alt="image" src="https://github.com/user-attachments/assets/89431d98-d1f8-41b4-9f26-c0a202a11bbf" />

# What Is This?|

The Wyrd Web is a reverse engineered, hybrid implementation of the [Wyrd Light](https://gowyrd.org/wyrd-light/) and [Wyrdoscope](https://gowyrd.org/wyrdoscope-device/). 

Try it here: https://wyrdweb.adam.nz/

> Based on decades of international research, including 28 years of experiments run at the Princeton Engineering Anomalies Research Lab, there is hard evidence that human intention and group experience impact random data streams through what has been coined “the consciousness field”. [This is] an invisible, subtle field (more like gravitational or electromagnetic field but also distinctly different from these), in which we all interact.
> 
> An analogy here would be to imagine you have static on an old TV. When you pay attention to it you start to see patterns within it. Then find these patterns are indeed, objectively there. Essentially, this implies that humans, through consciousness, are able to influence probabilities (random data) through non-physical means. 
> 
> https://gowyrd.org/faq/

The Wyrd Web app takes two streams of random numbers (zeros and ones) and monitors them for trends which deviate from expected randomness (eg. they start matching each other). It displayed on a large TV or screen shared on a video conference, providing groups with an easy and fun way to experiment with collective intention and receive immediate, visual feedback on their efforts.

Non-random, statistical patterns are represented as a moving, shimmering orb of light. The suggestion from the Wyrdo's is that different patterns represent different group experiences, but so far we don't know how to map them. In theory, groups should be able to learn how to deliberately make the orb change color and rotation.

- ⚫️ Baseline: the streams are bahaving randomly
- [cyan] 🔵 Correlated: both streams are generating more ones (↑) or more zeros (↓) 
- 🟡🔴 Diverging: one stream is generating more ones, and the other stream is generating more zeros 
- 🟢 Agreement: the streams are generating the exact same sequence of ones and zeros 
- 🟣 Pearson: the streams are trending together but not matching 
- 🔘 Anomaly: the unlikelyness of one of the patterns has crossed the boundary of statiscal significance

The more the streams are behaving in a statistically unlikely way, the brighter the orb becomes until eventually an anomaly is triggered.

This provides us with seven patterns, each with it's own color.  In addition Pearson can happen at the same time as correlated or diverging patterns and is represented by changes the rotation of the orb.  Your mission, should you choose to accept it, is to figure out how to control the patterns. 🤯 🦄 🤣 

There are two settings you can use to adjust the visual experience:
- **Mode (wow / mellow)** changes how dynamic the visual representation is.  Mellow might be more appropriate if you are going to have it running in the background for a longer period of time.  Wow might be more appropriate if you are actively watching and experimenting with it.
- **Sensitivity (conservative / moderate / engaging)** changes how statistically significant an event must be to show up. So in conservative mode you might only get an event every ten minutes, in moderate every three minutes, and engaging every minute.

As always, feedback welcome. 💬

# Caveats

- This is my first vibe coded app. I used Claude/ChatGPT to attempt to reverse engineer what the Wryd Light does from the limited information on their website (see [WYRDLIGHT.md](WYRDLIGHT.md)).
- The math involved is beyond my expertise so I can't validate the AI implementation.
- Currently the web app uses `crypto.getRandomValues()` to generate the streams of random numbers, this is not a quantum source.
- I'm still experimenting with visualisation and UI.  Once that seems to be working well, I'll look at wiring up a quantum source.

# Background

Since reading Dean Radin's latest book, The Science of Magic, I've been curious about psi phenomena. On his website he linked to Go Wyrd and I read about their [Wyrd Light](https://gowyrd.org/wyrd-light/) which uses stored sequences of quantum random numbers to visually display when statisically unlikely things are happening.  Excited, I was going to buy one … and then I saw how much they cost.

Disappointed, I started thinking about building something similar. A simple web app that takes two streams of random numbers, monitors them for divergence from randomness, and provides human friendly, visual feedback when unlikely things are happening.
