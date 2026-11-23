# Ludo Club

A four-player local Ludo game built with Angular and Three.js.

## Prerequisites

- Node.js 22.12 or newer
- npm 11 or newer
- Git
- A modern browser such as Chrome, Edge, or Firefox

For Playwright tests, install Chromium the first time with:

```bash
npx playwright install chromium
```

Verify the required tools:

```bash
node --version
npm --version
git --version
```

## Start the application

### 1. Clone the repository

```bash
git clone https://github.com/vignesh91191/ludogame.git
cd ludogame
```

If the project is already downloaded, open a terminal in the project root directory.

### 2. Install dependencies

```bash
npm install
```

Use `npm ci` instead when an exact dependency installation from `package-lock.json` is preferred.

### 3. Start the development server

```bash
npm start
```

The application runs at:

```text
http://127.0.0.1:4200
```

To stop the server, press `Ctrl+C` in the terminal.

## Build for production

```bash
npm run build
```

The production build is written to the `dist/ludo` directory.

## Run tests

Run the Playwright tests:

```bash
npm run test:e2e
```

Open the interactive Playwright UI:

```bash
npm run test:e2e:ui
```

The tests cover the rendered board, dice range, turn passing, token entry and movement, and resetting a game.
