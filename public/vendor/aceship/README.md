# Aceship legacy Spine playback

Vendored unchanged from Aceship's Toolbox on 2026-10-15:

- `spine-widget.js`: https://aceship.github.io/AN-EN-Tags/js/spine-widget.js
- `spine-skeleton-binary.js`: https://aceship.github.io/AN-EN-Tags/js/spine-skeleton-binary.js

Source repository: https://github.com/Aceship/AN-EN-Tags/tree/master/js

The app uses the runtime core from `spine-widget.js` together with the binary decoder for 3.5/3.6 skeletons. The original widget UI and render loop are unused. The app-owned WebGL player lives in `/public/spine-player.js`, with controls in `/public/viewer.js`; 3.7/3.8 use the matching official runtimes in `public/vendor/spine/`. Vendor files are unmodified.

These files are not covered by a new license from this project. Spine runtime terms: https://esotericsoftware.com/spine-runtimes-license
