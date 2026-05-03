import { test, expect } from '@playwright/test';
import { randomBytes } from 'crypto';

/**
 * Critical-path E2E: register → login → create server → create channel →
 * send message → message appears in channel list.
 *
 * Requires the full docker-compose stack:
 *   docker-compose --env-file infra/.env -f infra/docker-compose.yml up --build
 */
test('auth + chat critical path', async ({ page }) => {
  const suffix = randomBytes(4).toString('hex');
  const username = `user${suffix}`;
  const email = `${username}@e2e.example`;
  const password = 'Password123!';

  // ── Step 1: Register ────────────────────────────────────────────────────
  await page.goto('/register');

  await page.fill('input[placeholder="cooluser"]', username);
  await page.fill('input[type="email"]', email);
  await page.locator('input[type="password"]').nth(0).fill(password);
  await page.locator('input[type="password"]').nth(1).fill(password);
  await page.click('button:has-text("Continue")');

  // Step 2 of register: status picker — default (Online) is fine
  await page.click('button:has-text("Create Account")');
  await page.waitForURL(/\/login/, { timeout: 10_000 });

  // ── Step 2: Login ───────────────────────────────────────────────────────
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button:has-text("Sign in")');
  await page.waitForURL(/\/app/, { timeout: 10_000 });

  // ── Step 3: Create a server ─────────────────────────────────────────────
  await page.waitForSelector('[title="Create Server"]');
  await page.click('[title="Create Server"]');
  await page.fill('input[placeholder="Server name"]', `E2E Server ${suffix}`);
  // Click the Create button inside the modal (not the sidebar's + button)
  await page.locator('dialog, [role="dialog"], .fixed').last()
    .locator('button:has-text("Create")').click().catch(async () => {
      // Fallback: find Create button that isn't Cancel
      await page.locator('button:has-text("Create"):not(:has-text("Cancel"))').last().click();
    });

  await page.waitForURL(/\/app\/servers\//, { timeout: 10_000 });

  // ── Step 4: Create a text channel ───────────────────────────────────────
  // Reveal the + button by hovering over the "Text Channels" section header
  await page.waitForSelector('text=Text Channels', { timeout: 10_000 });
  await page.hover('text=Text Channels');
  await page.click('[title="Create Text Channel"]', { force: true });

  await page.fill('input[placeholder="channel-name"]', `general-${suffix}`);
  await page.locator('button:has-text("Create"):not([type="button"]:has-text("Cancel"))').last().click();

  // ── Step 5: Navigate to the channel ─────────────────────────────────────
  await page.click(`text=general-${suffix}`);
  await page.waitForURL(/\/channels\//, { timeout: 10_000 });

  // ── Step 6: Send a message ───────────────────────────────────────────────
  const message = `Hello E2E ${suffix}`;
  await page.waitForSelector('textarea', { timeout: 10_000 });
  await page.fill('textarea', message);
  await page.keyboard.press('Enter');

  // ── Step 7: Verify message appears in the channel list ──────────────────
  await expect(page.getByText(message)).toBeVisible({ timeout: 10_000 });
});
