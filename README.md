# Border Run

A drivable 3D web experience about Kurdish border-running. Vertical slice.

The form is the politics: instead of writing about smuggling, the player drives through a representation of it. An old FJ40 Land Cruiser, a roof full of jerry cans, a line drawn by other people. Drive smooth and the load stays. Flip and it tumbles. The line doesn't move; you do.

This is an experiment, not a finished game. It lives in its own repo, deployed to its own subdomain, with its own brand register — playful, gamey, less dignified than the [yashimosh.com](https://yashimosh.com) portfolio.

## Stack

- [three.js](https://threejs.org) `0.168.0` — rendering
- [cannon-es](https://github.com/pmndrs/cannon-es) `0.20.0` — rigid body physics
- [Vite](https://vitejs.dev) `5.4` + TypeScript — build
- No framework, no router, no design system. One HTML page, one TypeScript module.

## Run locally

```bash
npm install
npm run dev   # → http://localhost:5173
```

Build:

```bash
npm run build
npm run preview
```

## Controls

| | |
|---|---|
| `W` `A` `S` `D` / arrows | drive |
| `Space` | brake |
| `R` | reset truck + cargo |

## Slice scope

One scene, one truck, one terrain, one border line. The slice exists to prove three things:

1. The form is technically tractable in a browser.
2. The subject survives the form (it doesn't become *GTA: Kurdistan* parody).
3. The voice register holds.

Everything beyond that is feature creep before the seed is verified.

## Decisions log

[`DECISIONS.md`](./DECISIONS.md) — every architectural and creative call, dated, with reasoning. Read this before changing anything substantive.

Highlights:

- **FJ40 Land Cruiser, not a motorbike, not a kolbar on foot.** The Land Cruiser is the documented Kurdish smuggling vehicle. The kolbar (foot-porter) is a sacred subject in Kurdish public memory and isn't an avatar.
- **Authored heightfield, not procedural.** Procedural noise reads as "generic 3D demo"; authored shapes read as a place.
- **Cargo as the consequence loop.** Jerry cans + tarp-wrapped block are independent rigid bodies on the roof rack. Drive smooth → they stay. Flip → they tumble. No fail state, no score. The point is the small bad thing.
- **Dawn register, not golden hour.** Cool sky gradient, low sun behind ridge. The mood is "before anyone wakes up".

## Voice / OPSEC

Any UI/marketing copy passes the anti-AI-slop test before shipping: *could this sentence appear on someone else's LinkedIn carousel?* If yes, cut. No grand declarations. No hero/victim framings. Punchline structure works: set up, undercut.

## License

Not yet licensed. Source code visible for review; do not redistribute.
