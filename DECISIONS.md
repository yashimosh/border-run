# Border Run — decisions log

Every entry: the call, the reasoning, the date. Revisit when the slice reveals it was wrong.

## 2026-04-27 — Engine: three.js + cannon-es

three.js@0.168.0, cannon-es@0.20.0 (both ≥3 months old per global package policy).

Cannon-es over Rapier for the slice. Rapier is faster and has a better vehicle controller, but it ships as WASM and complicates Astro+Vite SSR/static config. The slice has one rigid body and a heightfield — cannon handles that without ceremony. Revisit if we need >50 dynamic bodies or proper raycast vehicle suspension.

## 2026-04-27 — Vehicle, not a walking character

NOT a kolbar on foot. The kolbar — the foot-porter who carries goods across the Iran/Iraq border, often shot at — is a sacred subject in Kurdish public memory. Turning that body into a player avatar in slice 1 is a register mistake. If the project earns the right to put a kolbar on screen later, it does so as NPC or set-piece, never as avatar.

## 2026-04-27 — FJ40 Land Cruiser, not a motorbike *(supersedes earlier "bike" call)*

First call was a motorbike. Yash overruled it the same day, correctly: the iconic Kurdish smuggling vehicle isn't a bike, it's the **Toyota Land Cruiser** — historically the FJ40 (short-wheelbase 1960s–80s), then the HJ75/70-series pickup ("Mowashera" / "Buffalo"). Old Land Rovers (Series II/III, Defender 110) sit in the same fleet but second-fiddle to the Toyota. This is documented: Iranian Kurdish militias buy LC71s by the dozen in Erbil; Toyota sales tripled in Iraq through the early 2010s; the 4WD is what the Zagros terrain demands.

Slice models the **FJ40 silhouette** in primitives — boxy body, vertical grille slats, round headlights, flat fenders, roof rack with three olive jerry cans + a tarp-wrapped cargo block, spare tire on the rear hatch. Cream-over-rust livery, period-correct fleet read.

Why FJ40 over HJ75: easier silhouette to read at low-poly (boxier, fewer surfaces), and the visual is *culturally* iconic — anyone who's seen 1980s footage of the region recognises it. HJ75 pickup is on the table for v2 once the model gets a real GLB import pipeline.

Bike kept on the back burner — could appear later as an NPC scout or a sub-route, since motorbike-runners do exist on the same corridors.

## 2026-04-27 — Arcade physics scaled for a 1500kg vehicle

Single dynamic Box body, no RaycastVehicle. Mass 1500kg (FJ40 curb + cargo). Drive force 7500N, reverse 4000N, yaw torque 1600. Wheels are visual-only and spin proportional to planar speed. Linear damping at 0.2 caps top speed naturally.

Real vehicle controller (RaycastVehicle in cannon, or move to Rapier for proper raycast suspension) is on the table once the slice answers whether the form works.

## 2026-04-27 — Authored terrain, not procedural

Hand-shaped heightfield: ridge to the north, valley E–W, gentle noise. 64×64, ~3m elementSize.

Procedural noise terrain reads as "generic 3D demo". Authored terrain — even crude — reads as a place. The Qandil ridge / Hewramân corridor / Şemzînan pass have specific shapes; the slice fakes that legibility with a ridge + valley silhouette. When we earn the right to a real DEM (SRTM is free), swap it in. Until then, authored is honest.

## 2026-04-27 — Single-scene vertical slice, not open world

One terrain tile, one border line, one bike, one event ("crossed"). No mission system, no economy, no NPCs.

The slice has to prove three things only:
1. The form is technically tractable in a browser.
2. The subject survives the form (it doesn't become a Grand Theft Auto: Kurdistan parody).
3. The voice register holds in HUD/UI copy.

Anything beyond those three is feature creep before the seed is verified.

## 2026-04-27 — Device floor: modern desktop and recent mobile

Target: 60fps on M1 / mid-range desktop GPU. Acceptable: 30fps on 2022+ Android/iPhone. No support for low-end mobile in slice. 64-vertex terrain + one rigid body is well under that budget; postprocessing stack is deliberately omitted in slice 1.

## 2026-04-27 — Localisation: EN-only in slice, hooks for KU/FA

UI strings in slice 1 are English only. KU (Sorani + Kurmancî) and FA from a real launch — but only if we have native co-writers. Machine-translated Kurdish is worse than no Kurdish.

When strings move out of HTML and into a JS module, wrap them in a `t()` helper from day one so the swap to a JSON dictionary later isn't a refactor.

## 2026-04-27 — No engine controller; arcade physics

The bike is a single dynamic Box body, not a CANNON RaycastVehicle. No suspension, no per-wheel friction, no gear sim. Arcade-feel: forward/reverse force, yaw torque, brake decay.

A real vehicle controller is on the table once the slice answers whether the form works at all. No point engineering suspension for a project that might not exist by next week.

## 2026-04-27 — Cargo as independent rigid bodies

Three jerry cans + one tarp-wrapped block live as separate dynamic Box bodies sitting on a roof-rack compound shape on the truck body. They rest by gravity + friction. Drive carefully and they stay put. Flip the truck or take a bump too hard and they tumble off the rack.

This is the slice's one bit of *consequence*. Crossing the line does nothing dramatic. Losing a jerry can does — the HUD ticks down from `4/4 secured` and a small `load shifted` line flashes. No siren, no fail-state, no penalty math. The point is the small bad thing.

Tradeoff: physics for cargo at 60Hz with 4 bodies is trivial cost. If we ever scale to a convoy (multiple trucks, dozens of items), revisit whether to model this.

## 2026-04-27 — Dawn register, not golden hour

Sky gradient (cool dust-blue → warmer horizon), low-angle sun behind the player from the +z ridge, soft hemi fill. Fog tint matches horizon so the ridge silhouette dissolves into sky cleanly. NOT a hero sunset. The mood is "before anyone wakes up", not "epic adventure".

## 2026-04-27 — Watchtower over checkpoint

The line is marked by a wooden watchtower with a tin roof, off to one side, no light on. Reads as: somebody is here, even if no one is in it tonight. A formal checkpoint with gates would have changed the register entirely (state-power-as-obstacle, GTA-cop framing). The empty tower is closer to what the corridor actually feels like.

## Open — to resolve when slice is reviewed

- Camera: chase cam works for slice; isometric / fixed angles per scene might fit the documentary register better. Try both before locking.
- Border crossing event: currently a single text trigger. Question is whether the *non-event* of crossing is the right note (you cross, nothing happens, the world does not acknowledge you) — that reads truer than fanfare, but might confuse first-time players.
- Whether this lives at `/experiments/smuggling/` or its own subdomain `experiments.yashimosh.com`. Same Astro project either way; subdomain is one Cloudflare record + one Astro routing rule away.
