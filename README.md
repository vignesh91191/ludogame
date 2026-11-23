# Ludo Club

An Angular and Three.js four-player local Ludo game.

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:4200`.

## Playwright tests

```bash
npm run test:e2e
```

The first Playwright run may require the Chromium browser:

```bash
npx playwright install chromium
```

The tests cover the rendered board, dice range, turn passing, token entry and movement, and resetting a game.
