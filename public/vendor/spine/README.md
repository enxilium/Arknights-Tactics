# Official Spine runtimes

Vendored unchanged from Esoteric Software's `spine-runtimes` repository on 2026-10-15. No CDN or npm downloads are needed during playback.

| Directory | Source revision                            | File                            |
| --------- | ------------------------------------------ | ------------------------------- |
| `3.7/`    | `9639bcc81722d7178fd9d1cdc1a3d55a4c91f989` | `spine-ts/build/spine-webgl.js` |
| `3.8/`    | `8b4844bd4b193ba9e54487ed397a777993cbad56` | `spine-ts/build/spine-webgl.js` |

Source: https://github.com/EsotericSoftware/spine-runtimes

SHA-256:

```text
3.7/spine-webgl.js  4af855a371895649bd153d28ae428012ccfac3eaf7a8416b183a68b650604891
3.8/spine-webgl.js  4b108bad314c152bf0ff7a7f56fce5c98073f05a2bfa53e880d6c24b6f7c3aa5
```

Each version's original license is included beside its runtime. Spine runtime licensing applies; these files are not relicensed by this project. The app's player and version selection live in `public/spine-player.js`. 3.5/3.6 exports continue to use the existing Aceship runtime and binary decoder in `public/vendor/aceship/`.
