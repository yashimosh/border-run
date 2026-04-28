# Credits

Border Run uses the following third-party assets. All shipped audio is **CC0 (public domain dedication)** unless stated otherwise — no attribution is legally required, but this file acknowledges the sources because that's the right thing to do.

## Audio — engine sounds

Source: [OpenGameArt — racing car engine sound loops](https://opengameart.org/content/racing-car-engine-sound-loops)
License: CC0
Files:
- `public/sfx/engine/loop_0.wav`
- `public/sfx/engine/loop_1_0.wav`
- `public/sfx/engine/loop_2_0.wav`
- `public/sfx/engine/loop_3_0.wav`
- `public/sfx/engine/loop_4_0.wav`
- `public/sfx/engine/loop_5_0.wav`

Used in `src/audio.ts` — six RPM samples crossfaded by a throttle/speed proxy.

## Audio — environment

Source: [Freesound](https://freesound.org)
License: CC0 (Creative Commons 0 / Public Domain Dedication)

| File | Freesound ID | Title | Author |
|---|---|---|---|
| `public/sfx/wind_desert.mp3` | [147777](https://freesound.org/s/147777/) | Wind blowing and howling in a barbed fence on the ground (Desert, Chile) | inchadney (1661766) |
| `public/sfx/tires_gravel.mp3` | [251661](https://freesound.org/s/251661/) | Tires on Gravel Road 1 | — |

## Audio — radio music (default tracks)

Source: [Freesound](https://freesound.org)
License: CC0

| File | Freesound ID | Title |
|---|---|---|
| `public/radio/01-saz_riff.mp3` | [749332](https://freesound.org/s/749332/) | SAZ instrument ORIGINAL — Chen, recorded at 130bpm |
| `public/radio/02-oud_and_ney.mp3` | [128355](https://freesound.org/s/128355/) | Oud and ney |
| `public/radio/03-persian_tar.mp3` | [232407](https://freesound.org/s/232407/) | Persian tar |
| `public/radio/04-tanbur_uzbekistan.mp3` | [843984](https://freesound.org/s/843984/) | Tanbur — Uzbekistan |

These are placeholder tracks meant to set tonal register. Drop your own MP3s in `public/radio/` (see [public/radio/README.md](./public/radio/README.md)) — they auto-discover.

## Code dependencies

See `package.json` for the full list. Notable runtime deps:

- [three.js](https://threejs.org) — MIT
- [cannon-es](https://github.com/pmndrs/cannon-es) — MIT
- [postprocessing](https://github.com/pmndrs/postprocessing) — Zlib
- [Tone.js](https://tonejs.github.io) — MIT
- [Howler.js](https://howlerjs.com) — MIT
- [GSAP](https://gsap.com) — Standard No Charge License (free for non-commercial + most commercial)
- [Express](https://expressjs.com) — MIT
- [Resend](https://resend.com) — for transactional email; uses your own API key

## License

The Border Run source code itself is currently unlicensed (all rights reserved by repo owner). Future may be MIT.
