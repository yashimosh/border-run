# Radio tracks

Drop MP3 / OGG / WAV files in this folder, then edit `src/radio.ts` to point stations at them.

## Why no songs ship by default

Two reasons:
1. Shipping copyrighted music is illegal.
2. Shipping CC0 music *I* picked overrides the player's taste.

So every station defaults to static. The radio works — it just has no signal until you give it one.

## Add a station

1. Drop `something.mp3` here. Files in `public/` are served at the root, so it'll be available at `/radio/something.mp3`.
2. Open `src/radio.ts` and edit the `DEFAULT_STATIONS` array:

   ```ts
   { name: "longwave", url: "/radio/something.mp3" },
   ```
3. Rebuild + redeploy.

## Source ideas (verify license before using)

- [Free Music Archive](https://freemusicarchive.org) — wide selection, filter by license
- [ccMixter](https://ccmixter.org) — CC remixes
- [Pixabay Music](https://pixabay.com/music/) — royalty-free
- [archive.org](https://archive.org/details/audio) — public domain + CC

For the recording register: low-key folk, period radio recordings, ambient drone, or static-y AM-style transmissions all fit. Anything triumphant or polished tips into the wrong tone.
