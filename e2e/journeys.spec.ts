import { test, expect, type Page } from '@playwright/test';
import { resetEmulators, signIn } from './helpers';

async function openAgenda(page: Page, phone: boolean) {
  if (phone) await page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: 'Agenda' }).click();
  else await page.getByRole('tab', { name: 'Agenda' }).click();
}

async function newEvent(page: Page, phone: boolean, o: { title: string; date: string; start: string; end: string; repeat?: string }) {
  if (phone) await page.getByRole('button', { name: 'New event' }).click();
  else await page.getByRole('button', { name: 'New Event' }).click();
  const dlg = page.getByRole('dialog', { name: 'New Event' });
  await dlg.getByLabel('Title').fill(o.title);
  await dlg.getByLabel('Start date').fill(o.date);
  await dlg.getByLabel('Start time').fill(o.start);
  await dlg.getByLabel('End time').fill(o.end);
  if (o.repeat) await dlg.getByLabel('Repeat', { exact: true }).selectOption(o.repeat);
  await dlg.getByRole('button', { name: 'Add' }).click();
  await expect(dlg).toBeHidden();
}

/** Click the agenda row for a title on a given day heading. */
function rowOn(page: Page, dayHeading: RegExp, title: string) {
  return page.locator('section').filter({ has: page.getByRole('heading', { name: dayHeading }) }).getByRole('button', { name: new RegExp(title) });
}

test('create, edit and delete events, including repeating ones', async ({ page }, info) => {
  const phone = info.project.name === 'iphone';
  await resetEmulators();
  await signIn(page);

  await newEvent(page, phone, { title: 'Dentist', date: '2026-10-14', start: '10:00', end: '10:45' });
  await newEvent(page, phone, { title: 'Gym', date: '2026-10-12', start: '18:00', end: '19:00', repeat: 'weekly' });
  await openAgenda(page, phone);
  await expect(rowOn(page, /14 October 2026/, 'Dentist')).toBeVisible();
  await expect(rowOn(page, /12 October 2026/, 'Gym')).toBeVisible();
  await expect(rowOn(page, /9 November 2026/, 'Gym')).toBeVisible();

  // Edit one occurrence only
  await rowOn(page, /19 October 2026/, 'Gym').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('dialog', { name: 'Edit Event' }).getByLabel('Title').fill('Gym legs');
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'This event only' }).click();
  await expect(rowOn(page, /19 October 2026/, 'Gym legs')).toBeVisible();
  await expect(rowOn(page, /26 October 2026/, 'Gym')).toBeVisible();
  await expect(rowOn(page, /12 October 2026/, 'Gym legs')).toHaveCount(0);

  // Delete one occurrence only
  await rowOn(page, /26 October 2026/, 'Gym').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete Event' }).click();
  await page.getByRole('button', { name: 'Delete this event only' }).click();
  await expect(page.getByRole('heading', { name: /26 October 2026/ })).toHaveCount(0);
  await expect(rowOn(page, /2 November 2026/, 'Gym')).toBeVisible();

  // This and following: change time from 2 Nov
  await rowOn(page, /2 November 2026/, 'Gym').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Edit', exact: true }).click();
  const ed = page.getByRole('dialog', { name: 'Edit Event' });
  await ed.getByLabel('Title').fill('Gym PM');
  await ed.getByLabel('Start time').fill('19:30');
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'This and following events' }).click();
  await expect(rowOn(page, /2 November 2026/, 'Gym PM')).toContainText('7:30 PM');
  await expect(rowOn(page, /9 November 2026/, 'Gym PM')).toContainText('7:30 PM');
  await expect(rowOn(page, /12 October 2026/, 'Gym')).toContainText('6:00 PM');
  await expect(rowOn(page, /19 October 2026/, 'Gym legs')).toBeVisible();

  // Delete the whole series (both halves of the split are separate series now)
  await rowOn(page, /9 November 2026/, 'Gym PM').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete Event' }).click();
  await page.getByRole('button', { name: 'Delete all events in series' }).click();
  await expect(rowOn(page, /16 November 2026/, 'Gym PM')).toHaveCount(0);
  await expect(rowOn(page, /12 October 2026/, 'Gym')).toBeVisible();

  // Restore from Recently deleted
  if (phone) { await page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: 'More' }).click(); await page.getByRole('button', { name: 'Recently deleted' }).click(); }
  else await page.getByRole('button', { name: 'Recently deleted' }).click();
  await page.getByRole('button', { name: 'Restore' }).first().click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(rowOn(page, /16 November 2026/, 'Gym PM')).toBeVisible();
});

test('drag to reschedule in week view (desktop)', async ({ page }, info) => {
  test.skip(info.project.name === 'iphone', 'touch drag is long-press; covered manually');
  await resetEmulators();
  await signIn(page);
  await newEvent(page, false, { title: 'Call Chandru', date: '2026-10-08', start: '10:00', end: '11:00' });
  await page.getByRole('tab', { name: 'Day' }).click();
  const ev = page.locator('.fc-event', { hasText: 'Call Chandru' });
  await ev.waitFor();
  const box = (await ev.boundingBox())!;
  const slot = (await page.locator('.fc-timegrid-slot').first().boundingBox())!.height;
  await page.mouse.move(box.x + box.width / 2, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 10 + slot * 2, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(800);
  await expect(page.locator('.fc-event:not(.fc-event-mirror)', { hasText: 'Call Chandru' })).toHaveCount(1);
  await page.locator('.fc-event:not(.fc-event-mirror)', { hasText: 'Call Chandru' }).click();
  await expect(page.getByRole('dialog')).toContainText(/11:(00|15) AM – 12:(00|15) PM/);
});

test('calendar colours, hiding and Apple import is idempotent', async ({ page }, info) => {
  const phone = info.project.name === 'iphone';
  await resetEmulators();
  await signIn(page);
  const importFile = async () => {
    if (phone) { await page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: 'More' }).click(); await page.getByRole('button', { name: 'Import from Apple' }).click(); }
    else await page.getByRole('button', { name: 'Import', exact: true }).click();
    await page.locator('input[type=file]').setInputFiles('src/core/fixtures/apple-family.ics');
  };
  await importFile();
  await page.getByRole('button', { name: 'Import', exact: true }).last().click();
  await page.getByText('Import complete').waitFor();
  await page.getByRole('button', { name: 'Import more files' }).click();
  await page.locator('input[type=file]').setInputFiles('src/core/fixtures/apple-family.ics');
  await expect(page.getByText('0 new · 0 updated · 5 already here · 1 failed')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Roll back' }).first().click();
  await page.getByRole('button', { name: 'Roll back' }).last().click();
  await expect(page.getByText('rolled back')).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await openAgenda(page, phone);
  await expect(page.getByText('Swimming lesson')).toHaveCount(0);

  // Hide a calendar
  await newEvent(page, phone, { title: 'Family dinner', date: '2026-10-15', start: '19:00', end: '21:00' });
  await expect(page.getByText('Family dinner')).toBeVisible();
  if (phone) await page.getByRole('button', { name: 'Calendars' }).click();
  await page.getByRole('checkbox', { name: 'Show Personal' }).click();
  if (phone) await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText('Family dinner')).toHaveCount(0);
});
