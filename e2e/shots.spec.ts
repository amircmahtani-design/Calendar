import { test } from '@playwright/test';
import { resetEmulators, signIn } from './helpers';
import path from 'node:path';

const out = process.env.SHOTS || 'shots';

test('screenshots of every view', async ({ page }, info) => {
  await resetEmulators();
  await signIn(page);
  const name = info.project.name;
  const phone = name === 'iphone';
  // Import the Apple fixture so views have content
  if (phone) { await page.getByRole('button', { name: 'More' }).click(); await page.getByRole('button', { name: 'Import from Apple' }).click(); }
  else await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles(path.resolve('src/core/fixtures/apple-family.ics'));
  await page.screenshot({ path: `${out}/${name}-import-preview.png` });
  await page.getByRole('button', { name: 'Import', exact: true }).last().click();
  await page.getByText('Import complete').waitFor();
  await page.screenshot({ path: `${out}/${name}-import-done.png` });
  await page.getByRole('button', { name: 'Close' }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${name}-month.png` });
  const views = phone ? ['Week', 'Day', 'Agenda'] : ['Week', 'Day', 'Year', 'Agenda'];
  for (const v of views) {
    if (phone) await page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: v }).click();
    else await page.getByRole('tab', { name: v }).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}/${name}-${v.toLowerCase()}.png` });
  }
});
