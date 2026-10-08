import { test } from '@playwright/test';
import { resetEmulators, signIn } from './helpers';

test('sheet screenshots', async ({ page }, info) => {
  const n = info.project.name;
  await resetEmulators();
  await signIn(page);
  await page.getByRole('button', { name: /New event/i }).first().click();
  const dlg = page.getByRole('dialog', { name: 'New Event' });
  await dlg.getByLabel('Title').fill('Lunch with Lia');
  await dlg.getByLabel('Location').fill('GAIA Dubai');
  await dlg.getByLabel('Repeat', { exact: true }).selectOption('custom');
  await page.screenshot({ path: `shots/${n}-editor.png` });
  await dlg.getByRole('button', { name: 'Add' }).click();
  if (n === 'iphone') await page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: 'Agenda' }).click();
  else await page.getByRole('tab', { name: 'Agenda' }).click();
  await page.getByRole('button', { name: /Lunch with Lia/ }).first().click();
  await page.screenshot({ path: `shots/${n}-detail.png` });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.getByRole('dialog').getByRole('button', { name: 'Back' }).click();
  if (n === 'iphone') await page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: 'Month' }).click();
  else await page.getByRole('tab', { name: 'Week' }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `shots/${n}-dark.png` });
});
