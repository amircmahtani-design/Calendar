import type { Page } from '@playwright/test';

export async function resetEmulators() {
  await fetch('http://127.0.0.1:8080/emulator/v1/projects/demo-calendar/databases/(default)/documents', { method: 'DELETE' });
  await fetch('http://127.0.0.1:9099/emulator/v1/projects/demo-calendar/accounts', { method: 'DELETE' });
}

export async function signIn(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => '__testSignIn' in window);
  await page.evaluate(() => (window as unknown as { __testSignIn: () => Promise<unknown> }).__testSignIn());
  await page.getByRole('button', { name: /New event/i }).first().waitFor();
  await page.waitForTimeout(800);
}
