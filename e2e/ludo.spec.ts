import { expect, test, type Page } from '@playwright/test';

async function openGame(page: Page, fixedDie?: number | readonly number[]): Promise<void> {
  if (fixedDie !== undefined) {
    const dice = typeof fixedDie === 'number' ? [fixedDie] : [...fixedDie];
    await page.addInitScript((value) => {
      let calls = 0;
      Object.defineProperty(window.crypto, 'getRandomValues', {
        configurable: true,
        value: (array: Uint32Array) => {
          const die = value[Math.min(Math.floor(calls / 10), value.length - 1)];
          array[0] = die - 1;
          calls += 1;
          return array;
        },
      });
    }, dice);
  }
  await page.goto('/');
}

test('renders the 3D board and four players', async ({ page }) => {
  await page.setViewportSize({ width: 876, height: 674 });
  await openGame(page);

  await expect(page).toHaveTitle(/Ludo Club/);
  await expect(page.locator('.board canvas')).toHaveCount(1);
  const layout = await page.evaluate(() => {
    const board = document.querySelector('.board')!.getBoundingClientRect();
    const canvas = document.querySelector('.board canvas')!.getBoundingClientRect();
    return {
      boardWidth: board.width,
      boardHeight: board.height,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      viewportHeight: window.innerHeight,
      documentHeight: document.documentElement.scrollHeight,
      playerRowsFit: [...document.querySelectorAll('.player-row')].every(
        (row) => row.getBoundingClientRect().height < 40,
      ),
    };
  });
  expect(Math.abs(layout.canvasWidth - layout.boardWidth)).toBeLessThan(1);
  expect(Math.abs(layout.canvasHeight - layout.boardHeight)).toBeLessThan(1);
  expect(layout.documentHeight).toBeLessThanOrEqual(layout.viewportHeight);
  expect(layout.playerRowsFit).toBe(true);
  await expect(page.getByRole('region', { name: 'Players' }).getByText('Red')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Players' }).getByText('Blue')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Players' }).getByText('Orange')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Players' }).getByText('Green')).toBeVisible();
});

test('rolls a value between one and six', async ({ page }) => {
  await openGame(page);

  await page.getByRole('button', { name: 'Roll dice' }).click();
  await expect(page.getByTestId('dice-title')).toHaveText(/^You rolled a [1-6]$/);
});

test('passes the turn when a player rolls without an available move', async ({ page }) => {
  await openGame(page, 3);

  await page.getByRole('button', { name: 'Roll dice' }).click();
  await expect(page.getByTestId('dice-title')).toHaveText('You rolled a 3');
  await expect(page.getByText("Blue's turn")).toBeVisible({ timeout: 3_000 });
});

test('clicking a 3D coin moves it onto its starting square', async ({ page }) => {
  await openGame(page, 6);

  await page.getByRole('button', { name: 'Roll dice' }).click();
  await expect(page.getByTestId('dice-title')).toHaveText('You rolled a 6');
  const canvas = page.locator('.board canvas');
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('The board canvas is not visible');

  await canvas.click({
    position: { x: bounds.width * 0.282, y: bounds.height * 0.295 },
  });
  await expect(page.getByTestId('game-status')).toContainText(
    'Red token moved onto the path.',
    { timeout: 4_000 },
  );
});

test('enters a token on six and moves it along the path', async ({ page }) => {
  await openGame(page, 6);

  await page.getByRole('button', { name: 'Roll dice' }).click();
  await expect(page.getByTestId('dice-title')).toHaveText('You rolled a 6');
  await page.getByRole('button', { name: 'Move Red token 1' }).click();
  await expect(page.getByTestId('game-status')).toContainText(
    'Red token moved onto the path.',
  );

  await page.getByRole('button', { name: 'Roll dice' }).click();
  await expect(page.getByTestId('dice-title')).toHaveText('You rolled a 6');
  await page.getByRole('button', { name: 'Move Red token 1' }).click();
  await expect(page.getByTestId('game-status')).toContainText(
    'Red token moved 6 spaces.',
    { timeout: 5_000 },
  );
});

test('captures an opponent token and animates it back to base', async ({ page }) => {
  test.setTimeout(60_000);
  await openGame(page, [6, 6, 6, 3, 6, 5, 3, 3, 3]);
  const blueRow = page.locator('.player-row').filter({ hasText: 'Blue' });

  const move = async (die: number, tokenName?: string): Promise<void> => {
    await page.getByRole('button', { name: 'Roll dice' }).click();
    await expect(page.getByTestId('dice-title')).toHaveText(`You rolled a ${die}`);
    if (tokenName) await page.getByRole('button', { name: tokenName }).click();
  };

  await move(6, 'Move Red token 1');
  await move(6, 'Move Red token 1');
  await move(6, 'Move Red token 1');
  await move(3, 'Move Red token 1');
  await move(6, 'Move Blue token 1');
  await move(5, 'Move Blue token 1');

  await move(3);
  await expect(page.getByText("Green's turn")).toBeVisible({ timeout: 3_000 });
  await move(3);
  await expect(page.getByText("Red's turn")).toBeVisible({ timeout: 3_000 });
  await expect(blueRow).toHaveAttribute('data-tokens-in-base', '3');

  const animationStarted = Date.now();
  await move(3, 'Move Red token 1');
  await expect(page.getByRole('button', { name: 'Roll dice' })).toBeEnabled({
    timeout: 5_000,
  });
  expect(Date.now() - animationStarted).toBeGreaterThanOrEqual(550);
  await expect(page.getByTestId('game-status')).toContainText(
    'Captured! That token goes back to base.',
  );
  await expect(blueRow).toHaveAttribute('data-tokens-in-base', '4');
});

test('new game restores the initial player and state', async ({ page }) => {
  await openGame(page, 3);

  await page.getByRole('button', { name: 'Roll dice' }).click();
  await expect(page.getByText("Blue's turn")).toBeVisible({ timeout: 3_000 });
  await page.getByRole('button', { name: 'New game' }).click();

  await expect(page.getByText("Red's turn")).toBeVisible();
  await expect(page.getByTestId('game-status')).toHaveText(
    'Roll a 6 to bring a token onto the board.',
  );
});
