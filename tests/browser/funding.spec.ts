import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const password = process.env.CLEARLINE_BROWSER_PASSWORD!;
async function signIn(page: Page, email: string) {
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
}
async function screenshot(page: Page, info: TestInfo, name: string) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  const file = info.outputPath(`${info.project.name}-${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  await info.attach(name, { path: file, contentType: 'image/png' });
  if (info.project.name === 'phone') {
    await page.evaluate(() => window.scrollTo(0, 0));
    const viewport = info.outputPath(`phone-${name}-viewport.png`);
    await page.screenshot({ path: viewport, fullPage: false });
    await info.attach(`${name}-viewport`, { path: viewport, contentType: 'image/png' });
  }
}
async function clock(page: Page, at: string) {
  const field = page.getByLabel('Replay time (UTC)', { exact: true });
  const type = await field.getAttribute('type');
  await field.fill(type === 'datetime-local' ? at.replace(/Z$/, '') : at);
  await page.getByRole('button', { name: 'Set replay time', exact: true }).click();
  await expect.poll(async () => (await (await page.request.get('/api/funding')).json()).at).toBe(at);
}
async function openAdvance(page: Page, id = 'advance-1') {
  await page.getByRole('button', { name: 'Approvals', exact: true }).click();
  const open = page.getByRole('button', { name: `Open ${id}`, exact: true });
  if (!(await open.count())) await page.getByText('All supplied advances', { exact: true }).click();
  await open.first().click();
}
async function download(page: Page, button: string) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: button, exact: true }).click();
  const file = await pending;
  expect(await file.failure()).toBeNull();
  const filename = await file.path();
  expect(filename).toBeTruthy();
  return readFile(filename!);
}
test('prepare, approve, record payout, flag late repayment and export evidence', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  await expect(page).toHaveURL(new URL('/funding', info.project.use.baseURL!).href);
  await expect(page).toHaveTitle('Clearline Funding Desk');
  await signIn(page, 'maker@example.test');
  expect(errors).toEqual([]);
  await expect(page.getByText(/synthetic|simulation/i).first()).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Funding desk' })).toBeVisible();
  await expect(page.getByRole('link', { name: /stablecoin|documentary credits|collections|investigat/i })).toHaveCount(0);
  await screenshot(page, info, 'approvals');
  await openAdvance(page);
  await page.getByLabel('Decision reason', { exact: true }).fill('Synthetic operator checked the supplied invoice and terms.');
  await page.getByRole('button', { name: 'Prepare advance', exact: true }).click();
  await expect.poll(async () => (await (await page.request.get('/api/funding')).json()).data.advances[0].state).toBe('prepared');

  const prepared = await (await page.request.get('/api/funding')).json();
  const origin = new URL(info.project.use.baseURL!).origin;
  const self = await page.request.post('/api/funding', {
    headers: { origin, 'x-csrf-token': prepared.csrf },
    data: { action: 'approve', advance_id: 'advance-1', reason: 'Attempted self approval', revision: prepared.revision },
  });
  expect(self.ok()).toBe(false);
  expect((await (await page.request.get('/api/funding')).json()).data.advances[0].state).toBe('prepared');

  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await signIn(page, 'checker@example.test');
  await openAdvance(page);
  await page.getByLabel('Decision reason', { exact: true }).fill('Synthetic treasury review: limit, cash and terms checked.');
  await page.getByRole('button', { name: 'Approve advance', exact: true }).click();
  await expect.poll(async () => (await (await page.request.get('/api/funding')).json()).data.advances[0].state).toBe('approved');
  await screenshot(page, info, 'approved-evidence');

  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await signIn(page, 'maker@example.test');
  await openAdvance(page);
  await clock(page, '2026-11-10T09:01:00Z');
  await page.getByRole('button', { name: 'Record sample payout', exact: true }).click();
  await expect.poll(async () => (await (await page.request.get('/api/funding')).json()).ledger.rows[0].paid).toBe('100000');
  await screenshot(page, info, 'supplier-paid-still-owed');
  await clock(page, '2026-11-19T10:00:00Z');
  await page.getByRole('button', { name: 'Exceptions', exact: true }).click();
  await screenshot(page, info, 'overdue-exceptions');
  const late = await (await page.request.get('/api/funding')).json();
  expect(late.ledger.exceptions.some((e: { code: string }) => e.code === 'overdue')).toBe(true);
  await openAdvance(page);
  await page.getByRole('button', { name: 'Record sample receipt', exact: true }).click();
  await expect.poll(async () => (await (await page.request.get('/api/funding')).json()).ledger.rows[0].outstanding).toBe('60000');
  await expect(page.getByRole('heading', { name: 'Still owed to the provider', exact: true })).toBeVisible();
  await expect(page.getByText(/60,000/).first()).toBeVisible();
  await expect(page.getByText('advance-1', { exact: true }).first()).toBeVisible();
  await screenshot(page, info, 'partial-repayment');
  expect((await download(page, 'Daily digest')).toString('utf8')).toContain('60000');
  expect((await download(page, 'Evidence pack')).subarray(0, 2).toString()).toBe('PK');
  expect((await download(page, 'Open advances CSV')).toString('utf8')).toContain('60000');
  expect((await download(page, 'Open advances XLSX')).subarray(0, 2).toString()).toBe('PK');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await screenshot(page, info, 'settings');

  const source = (await readFile('fixtures/funding/advances.csv', 'utf8')).replaceAll('advance-1', 'advance-2').replaceAll('INV-001', 'INV-002');
  await page.getByLabel('Import type', { exact: true }).selectOption('advances');
  await page.getByLabel('CSV file', { exact: true }).setInputFiles({ name: 'synthetic-second-advance.csv', mimeType: 'text/csv', buffer: Buffer.from(source) });
  await page.getByRole('button', { name: 'Import records', exact: true }).click();
  await expect.poll(async () => (await (await page.request.get('/api/funding')).json()).data.advances.length).toBe(2);
  await page.getByRole('button', { name: 'Approvals', exact: true }).click();
  await openAdvance(page, 'advance-2');
  await page.getByLabel('Decision reason', { exact: true }).fill('Prepare second synthetic case for a treasury refusal.');
  await page.getByRole('button', { name: 'Prepare advance', exact: true }).click();
  await expect.poll(async () => (await (await page.request.get('/api/funding')).json()).data.advances[1].state).toBe('prepared');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await signIn(page, 'checker@example.test');
  await openAdvance(page, 'advance-2');
  await page.getByLabel('Decision reason', { exact: true }).fill('');
  await expect(page.getByRole('button', { name: 'Decline advance', exact: true })).toBeDisabled();
  const declineReason = 'Declined: the earlier advance remains overdue.';
  await page.getByLabel('Decision reason', { exact: true }).fill(declineReason);
  await page.getByRole('button', { name: 'Decline advance', exact: true }).click();
  await expect.poll(async () => (await (await page.request.get('/api/funding')).json()).data.advances[1].state).toBe('declined');
  const decision = (await (await page.request.get('/api/funding')).json()).data.decisions.find((d: { advance_id: string }) => d.advance_id === 'advance-2');
  expect(decision.reason).toBe(declineReason);
  expect(decision.actor_id).toBe('checker');
  await screenshot(page, info, 'declined-evidence');
  expect(errors).toEqual([]);
});

test('viewer and anonymous requests cannot mutate or impersonate treasury', async ({ page, request }, info) => {
  const origin = new URL(info.project.use.baseURL!).origin;
  for (const path of ['/requests', '/api/requests', '/api/accounting']) {
    expect((await request.get(path)).status()).toBe(404);
  }
  expect((await request.get('/api/funding')).status()).toBe(401);
  await page.goto('/funding');
  await signIn(page, 'viewer@example.test');
  const before = await (await page.request.get('/api/funding')).json();
  for (const extra of [{}, { actor_id: 'checker', role: 'approver' }]) {
    const denied = await page.request.post('/api/funding', {
      headers: { origin, 'x-csrf-token': before.csrf },
      data: { action: 'approve', advance_id: 'advance-1', reason: 'Forbidden attempt', revision: before.revision, ...extra },
    });
    expect(denied.ok()).toBe(false);
  }
  const csrf = await page.request.post('/api/funding', {
    headers: { origin }, data: { action: 'clock', at: '2026-11-20T00:00:00Z' },
  });
  expect(csrf.ok()).toBe(false);
  const crossOrigin = await page.request.post('/api/funding', {
    headers: { origin: 'https://untrusted.example', 'x-csrf-token': before.csrf },
    data: { action: 'clock', at: '2026-11-20T00:00:00Z' },
  });
  expect(crossOrigin.ok()).toBe(false);
  const after = await (await page.request.get('/api/funding')).json();
  expect(after.revision).toBe(before.revision);
  expect(after.at).toBe(before.at);
});
