# Arknights Tactics

A Next.js starter with an empty `/` and a local asset workshop at `/data`.

## Run

Requires Node.js 22.18 or newer and npm.

```sh
npm install
npm run dev
```

Open [the workshop](http://127.0.0.1:3000/data). Select an operator and outfit, then click **Download & preview**. All available front, back, and base sprite views and the operator's skill icons are downloaded. Click a skill icon to play its full animation sequence, or use the dropdown for full skills and individual clips. Change views, pause, restart, mirror, adjust speed, or zoom in the player.

Files are saved to:

```text
public/operators/<operator-id>/<outfit-id>/
  manifest.json
  front/  # original .skel, .atlas, and all referenced .png textures
  back/   # when available
  build/  # when available
  skills/ # original skill icon PNGs
```

`manifest.json` records the operator, outfit, source revision, local file paths, sizes, source hashes, and skill metadata. Repeat downloads verify and reuse the saved bundle. Earlier imports automatically gain skill icons and an updated manifest without downloading their sprite files again. The icon source revision is recorded separately as `skillRevision`. Changed or incomplete saved bundles are preserved and reported; move their folder out of `public/operators/` to import a fresh copy. Downloaded assets and the source catalog cache are ignored by Git.

## Source of availability

The app reads [Aceship's sprite repository](https://github.com/Aceship/Arknight-Images/tree/main/spineassets/character), including its actual outfit filenames. A bundle is listed only if it has a skeleton, atlas, and primary PNG texture. Operator names, outfit names, skill names, and icon aliases come from the English character, patch, skin, and skill tables hosted by [Aceship's Toolbox](https://aceship.github.io/AN-EN-Tags/akhrchars.html). Metadata entries without sprite bundles are excluded. Unknown outfit names fall back to the actual asset identifier. Skill icons are checked against the repository's actual `skills/` inventory and downloaded with source hash verification.

Catalogs are cached in `.cache/aceship/catalog.json` for one hour. **Refresh from Aceship** requests a fresh inventory. If upstream is unavailable and a saved inventory exists, the app labels the fallback. The first fetch requires internet access; no GitHub token is needed, but GitHub's public API limits apply.

Imports use the exact Git commit recorded by the inventory, verify each file against its Git blob hash, and publish the completed folder atomically. Referenced atlas pages are checked against the inventory before download. Selections are validated on the server; the browser cannot supply arbitrary remote URLs or disk paths. Concurrent imports of the same outfit are locked. If a process is forcibly terminated mid-import, stop the server and remove that outfit's stale lock directory in `.cache/aceship/locks/` before retrying.

## Playback and scope

The preview uses our own WebGL player, isolated in an iframe, and selects a local runtime from the skeleton's export version. Spine 3.5/3.6 use Aceship's legacy runtime core and binary decoder; 3.7/3.8 use matching official Spine runtimes and native binary decoding. These are the original skeletal animations and texture atlases, **not baked frame-by-frame sprite sheets**. No runtime CDN or asset conversion is required. Skadi's Sublimation outfit (3.8.99) and Ch'en the Holungday's default outfit (3.5.51) have been checked with the player. Unsupported families, including 4.x, show an explicit error and retain the saved originals. Some historical patch formats, such as 3.8.75, are rejected by the official runtime; support for a family does not guarantee every patch or skeleton variation has been visually verified.

Skill descriptions, activation types, lifetimes, and blackboard values are imported at maximum skill level (M3 where available). Description placeholders are resolved to numbers, source formatting tags are removed, and the result is rendered as plain text. Earlier imports upgrade their metadata without downloading existing sprite files or icons again.

Full skills follow Aceship's explicit `animlist.json` mappings when available. Otherwise, like Aceship, numbered skill animation groups map to the last N operator skills. Clip suffixes are not universal skill numbers. For Ch'en the Holungday, `Skill_Loop` maps to S1, `Skill_1_Loop` to S2, and `Skill_2_Loop` to S3.

Skill lifetime comes from gameplay metadata, independently of animation length. Timed skills run opening → one continuously looping active entry → ending → idle, with a decreasing duration bar. Instant skills play their action once without a timed bar; an instant activation can still have a multi-second animation. Indefinite skills loop until **End skill** is pressed. Passive skills have descriptions without an activation preview.

Ammo takes precedence over numeric duration, since ammo skills can have a source duration of 0 or -1. Ch'en the Holungday's three skills are all ammo-based. The preview shows remaining ammo instead of seconds and spends the documented number per animation cycle; it does not simulate target conditions, charged variants, ammunition-saving talents, or combat effects. Descriptions retain those conditions. Unknown ammo counts require manual ending rather than an invented time limit.

Phases are queued on one Spine track with short crossfades, using animation time rather than wall-clock timers. The active entry stays looped for its lifetime, without inserting a skill-idle pause or resetting the skeleton on each cycle. The bar reads the same track time, so pause and speed changes affect it together with the animation. **End skill** finishes the current cycle before the ending animation. Clicking another skill or selecting a raw clip cancels the previous queue. **Restart** replays the current selection. Skills without distinct matching clips are labelled; their icons still open their descriptions. Original phase clips remain under **Individual clips** in the dropdown.

This workshop imports the selected outfit's sprite bundle. Separate combat effects, projectiles, summons, audio, splash art, and live illustrations are outside this first version.

New files are served through `/api/data/files/...` so previews also work when files are imported after a production build; Next.js does not reliably discover runtime additions to `public/` in production.

This is a local developer tool that writes to its project directory. Both start commands bind to loopback. Keep it local; public hosting would require authentication, storage limits, and durable writable storage. Serverless hosting with a read-only project directory will not support imports.

Arknights assets retain their original owners' rights. Check artwork permissions and the applicable Spine runtime terms before distributing the app or assets. Runtime source provenance and original licenses are documented in `public/vendor/aceship/README.md` and `public/vendor/spine/README.md`.

## Checks

```sh
npm test
npm run lint
npm run typecheck
npm run build
npm start
```

The tests cover inventory filtering, outfit mapping, path validation, multiple atlas pages, integrity failures, atomic imports, cleanup, preservation of changed bundles, additive icon upgrades, official skill mappings, version detection, native JSON decoding, and skill playback with pause, speed, ammo, and manual ending using each vendored Spine animation runtime.
