// Run with the Firestore emulator up: npm run test:rules
import { describe, it, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc } from 'firebase/firestore';

let env: RulesTestEnvironment;
const owner = { email: 'amircmahtani@gmail.com', email_verified: true };
const ev = { calendarId: 'c', title: 'x', allDay: false, start: '2026-01-01T09:00:00', end: '2026-01-01T10:00:00', tz: 'Asia/Dubai', startUtc: 1, endUtc: 2 };

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-rules', firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 } });
});
afterAll(async () => { await env.cleanup(); });

describe('firestore.rules', () => {
  it('owner can write and read their events', async () => {
    const db = env.authenticatedContext('u1', owner).firestore();
    await assertSucceeds(setDoc(doc(db, 'users/u1/events/e1'), ev));
    await assertSucceeds(getDoc(doc(db, 'users/u1/events/e1')));
  });
  it('another Google account is refused even under its own uid', async () => {
    const db = env.authenticatedContext('u2', { email: 'someone@gmail.com', email_verified: true }).firestore();
    await assertFails(setDoc(doc(db, 'users/u2/events/e1'), ev));
  });
  it('owner cannot touch another uid path', async () => {
    const db = env.authenticatedContext('u1', owner).firestore();
    await assertFails(getDoc(doc(db, 'users/u9/events/e1')));
  });
  it('unverified email and signed-out users are refused', async () => {
    await assertFails(getDoc(doc(env.authenticatedContext('u1', { email: owner.email, email_verified: false }).firestore(), 'users/u1/events/e1')));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'users/u1/events/e1')));
  });
  it('rejects invalid events and calendars', async () => {
    const db = env.authenticatedContext('u1', owner).firestore();
    await assertFails(setDoc(doc(db, 'users/u1/events/bad'), { ...ev, endUtc: 0 }));
    await assertFails(setDoc(doc(db, 'users/u1/calendars/bad'), { name: 'x', color: 'blue', visible: true, archived: false }));
    await assertSucceeds(setDoc(doc(db, 'users/u1/calendars/ok'), { name: 'x', color: '#007AFF', visible: true, archived: false }));
  });
  it('nothing outside users/ is reachable', async () => {
    await assertFails(getDoc(doc(env.authenticatedContext('u1', owner).firestore(), 'other/doc')));
  });
});
