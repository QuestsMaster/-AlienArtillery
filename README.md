# Alien Artillery

Alien Artillery is an original, single-player turn-based artillery game for iPhone. It runs as a landscape PWA with canvas-rendered aliens, terrain, effects, and controls.

## Local development

Use Node.js 22.12 or newer, then run `npm install` and `npm run dev`. The production command is `npm run build`; it creates `dist/` and generates the versioned offline service worker after Vite has emitted all assets.

## iPhone installation and offline use

Deploy `dist/` over HTTPS, open it in Safari, wait until the in-game status says `Готово к офлайн-игре`, then use Share > Add to Home Screen. The first successful online load precaches the complete build. Follow the exact device acceptance checklist in [docs/testing/iphone-acceptance.md](docs/testing/iphone-acceptance.md).

See [docs/deployment.md](docs/deployment.md) for GitHub Pages deployment guidance.
