# Radio tracks

**Drop audio files in this folder. They become radio stations automatically.**

## How it works

The server scans this directory at runtime. Any `*.mp3`, `*.ogg`, `*.wav`, or `*.m4a` file becomes a station. The station name comes from the filename:

- `karwan-mahmudi.mp3` → "karwan mahmudi"
- `01-bextiyar-salih.mp3` → "bextiyar salih" (numeric prefix is for sort order, stripped from display)
- `hozan_dilgesh.mp3` → "hozan dilgesh"

Files appear in the radio in **filename sort order** — use a `01-`, `02-`, `03-` prefix if you want a specific ordering.

## Why no music ships by default

Two reasons that I want to be explicit about:

1. **Legal.** Shipping copyrighted Kurdish folk music in a public repo gets the repo taken down and exposes the maintainer to liability. "Old" is not the same as "public domain" — recording rights survive composition expiration. archive.org search results often surface unclear-license content.
2. **Aesthetic.** Whoever forks this should pick their own music, not inherit my taste.

So the radio defaults to procedural synthesized stations (qandil fm, تهران ۱, longwave). They're playable but they're not the same as a real ferqîn or Şivan Perwer recording.

## What to drop in

For Border Run's register (Kurdish smuggler at dawn), things that fit:

- **Hunermendên kurdî** — Şivan Perwer, Ciwan Haco, Diyar, Aynur Doğan, Mahmoud Azizi, Kayhan Kalhor (instrumental)
- **Field recordings** — daf, zurna, blûr, tanbur instrumentals
- **Older 78rpm-style** if you can find verifiable PD ones (very rare for Kurdish music)
- **Ambient drones** that drift in/out of "signal"

For the recording register, **avoid**:
- Anything triumphant or polished (tips wrong)
- Modern Kurdish pop with Western beats (loses the period feel)
- Anthems / political music with overt subject matter (the form is the politics; the music shouldn't restate it)

## Source ideas (verify license before using)

- [Free Music Archive](https://freemusicarchive.org) — wide selection, filter by license
- [Internet Archive 78rpm collection](https://archive.org/details/78rpm) — pre-1923 recordings are US public domain
- [ccMixter](https://ccmixter.org) — CC remixes
- [Pixabay Music](https://pixabay.com/music/) — royalty-free
- Your own recordings or properly-licensed personal collection

## File size guidance

- Keep files under 5MB each so the page doesn't get heavy
- 192 kbps MP3 or VBR is plenty for a radio-character signal that runs through a lowpass anyway
- Loop seamlessly if you want continuous play, but the radio also plays once-through and idles silent — both fine

## After adding files

No rebuild needed. The `/api/radio-tracks` endpoint reads the directory live. Just refresh the page.
