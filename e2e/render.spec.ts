import { expect, Page, test } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Render regression. Every e2e/characters/<name>.json is worn, saved through
 * the right click "Save as PNG", and diffed pixel for pixel against
 * <name>.png beside it.
 *
 * The baseline is made by this same test pointed at the live site, so both
 * sides come out of the same headless chromium:
 *
 *   E2E_BASE=https://henehoe.app npx playwright test render --update-snapshots
 *
 * A png exported from your own browser would not do, a hue filter can land a
 * shade off between browsers and fail every run for nothing
 */

const DIR = join(__dirname, 'characters');

// the canvas once two reads half a second apart agree, ie every sheet has
// landed and drawn. saving earlier snapshots a half dressed character
const settled = async (page: Page) => {
  const canvas = page.locator('[class*="Char_scale"] canvas');
  const read = () => canvas.evaluate(c => (c as HTMLCanvasElement).toDataURL());
  await expect
    .poll(async () => {
      const a = await read();
      await page.waitForTimeout(500);
      return a === (await read());
    }, { timeout: 30_000 })
    .toBe(true);
};

for (const file of readdirSync(DIR).filter(f => f.endsWith('.json'))) {
  const name = file.replace(/\.json$/, '');

  test(`${name} renders like the live site`, async ({ page }) => {
    // still, or the png is whichever frame the clock happened to be on
    const outfit = {
      // a json saved from a windows editor can start with a BOM
      ...JSON.parse(readFileSync(join(DIR, file), 'utf8').replace(/^﻿/, '')),
      animating: false,
    };
    await page.addInitScript(o => {
      localStorage.setItem('chars', JSON.stringify({ chars: [o], activeId: o.id }));
    }, outfit);
    await page.goto('/');

    await settled(page);
    // dispatched rather than clicked, here and on the menu, the closet panel
    // can sit over either and swallow a real click. layout isn't what's tested
    await page
      .locator('[class*="Char_scale"]')
      .dispatchEvent('contextmenu', { clientX: 400, clientY: 300 });
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('menuitem', { name: /Save as PNG/ }).dispatchEvent('click'),
    ]);

    // exact. same browser on both sides, so any pixel off is a real change
    expect(readFileSync(await download.path())).toMatchSnapshot(`${name}.png`, {
      threshold: 0,
      maxDiffPixels: 0,
    });
  });
}
