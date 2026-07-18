// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * The ledger/allocation engine (CLAUDE.md §16 test matrix): exact pay, partial, overpay→credit,
 * multi-invoice oldest-due-first, replayed idempotency key, reversal, and each channel. Money is
 * integer cents; balances are derived; payments immutable (reversals only).
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { freshApp } from './harness';
import { invoices, invoiceItems, payments, paymentAllocations, families } from '../src/db/schema';
import type { PaymentChannel } from '../src/db/schema';

let app: Awaited<ReturnType<typeof freshApp>>;
let ledger: typeof import('../src/billing/ledger');
const ACTOR = { userId: 'usr_admin', role: 'admin', name: 'Admin' };
const D = (iso: string) => new Date(iso);

beforeAll(async () => {
  app = await freshApp();
  ledger = await import('../src/billing/ledger');
});
beforeEach(() => {
  const { db } = app.dbmod;
  for (const t of [paymentAllocations, payments, invoiceItems, invoices, families]) db.delete(t).run();
});

/** A family + an invoice with one item, due on `due`. Returns ids. */
function famWithInvoice(amountCents: number, due: string, periodKey = 'p1') {
  const { db } = app.dbmod;
  const ts = new Date();
  const familyId = 'fam_1';
  db.insert(families).values({ id: familyId, name: 'Fam', status: 'active', discountKind: 'none', discountValue: 0, createdAt: ts, updatedAt: ts }).run();
  const invId = mkInvoice(familyId, amountCents, due, periodKey);
  return { familyId, invId };
}
function mkInvoice(familyId: string, amountCents: number, due: string, periodKey: string) {
  const { db } = app.dbmod;
  const ts = new Date();
  const invId = `inv_${periodKey}`;
  db.insert(invoices).values({ id: invId, familyId, label: `Invoice ${periodKey}`, periodKey, dueDate: due, status: 'open', createdAt: ts, updatedAt: ts }).run();
  db.insert(invoiceItems).values({ id: `it_${periodKey}`, invoiceId: invId, description: 'Tuition', amountCents, studentId: null, createdAt: ts }).run();
  return invId;
}
const invStatus = (id: string) => app.dbmod.db.select().from(invoices).where(eq(invoices.id, id)).get()?.status;

describe('allocation + balance', () => {
  it('exact payment marks the invoice paid; balance zero', () => {
    const { familyId, invId } = famWithInvoice(15000, '2026-07-01');
    const r = ledger.recordPayment({ familyId, amountCents: 15000, channel: 'cash', occurredAt: D('2026-07-05'), idempotencyKey: 'k1' }, ACTOR);
    expect(r).toMatchObject({ duplicate: false, allocatedCents: 15000, creditCents: 0 });
    expect(invStatus(invId)).toBe('paid');
    expect(ledger.familyBalance(familyId).balanceCents).toBe(0);
  });

  it('partial payment leaves partially_paid + remaining balance', () => {
    const { familyId, invId } = famWithInvoice(15000, '2026-07-01');
    ledger.recordPayment({ familyId, amountCents: 6000, channel: 'zelle', occurredAt: D('2026-07-05'), idempotencyKey: 'k1' }, ACTOR);
    expect(invStatus(invId)).toBe('partially_paid');
    expect(ledger.familyBalance(familyId).owedCents).toBe(9000);
  });

  it('overpayment becomes family credit', () => {
    const { familyId, invId } = famWithInvoice(10000, '2026-07-01');
    const r = ledger.recordPayment({ familyId, amountCents: 13000, channel: 'cash', occurredAt: D('2026-07-05'), idempotencyKey: 'k1' }, ACTOR);
    expect(r.allocatedCents).toBe(10000);
    expect(r.creditCents).toBe(3000);
    expect(invStatus(invId)).toBe('paid');
    const bal = ledger.familyBalance(familyId);
    expect(bal.balanceCents).toBe(-3000);
    expect(bal.creditCents).toBe(3000);
  });

  it('multi-invoice payment allocates oldest-due-first', () => {
    const { familyId } = famWithInvoice(5000, '2026-08-01', 'aug'); // later due
    mkInvoice(familyId, 5000, '2026-07-01', 'jul'); // earlier due
    // Pay 7000 → fully covers Jul (5000) then 2000 of Aug.
    ledger.recordPayment({ familyId, amountCents: 7000, channel: 'check', occurredAt: D('2026-07-10'), idempotencyKey: 'k1' }, ACTOR);
    expect(invStatus('inv_jul')).toBe('paid');
    expect(invStatus('inv_aug')).toBe('partially_paid');
    expect(ledger.familyBalance(familyId).owedCents).toBe(3000);
  });

  it('a replayed idempotency key returns the original, records nothing new', () => {
    const { familyId } = famWithInvoice(10000, '2026-07-01');
    const first = ledger.recordPayment({ familyId, amountCents: 10000, channel: 'cash', occurredAt: D('2026-07-05'), idempotencyKey: 'dupe' }, ACTOR);
    const replay = ledger.recordPayment({ familyId, amountCents: 10000, channel: 'cash', occurredAt: D('2026-07-05'), idempotencyKey: 'dupe' }, ACTOR);
    expect(replay.duplicate).toBe(true);
    expect(replay.paymentId).toBe(first.paymentId);
    expect(app.dbmod.db.select().from(payments).all()).toHaveLength(1);
  });

  it('reversal nets the payment out (invoice back to open, balance restored)', () => {
    const { familyId, invId } = famWithInvoice(10000, '2026-07-01');
    const p = ledger.recordPayment({ familyId, amountCents: 10000, channel: 'cash', occurredAt: D('2026-07-05'), idempotencyKey: 'k1' }, ACTOR);
    expect(invStatus(invId)).toBe('paid');
    ledger.reversePayment(p.paymentId, ACTOR);
    expect(invStatus(invId)).toBe('open');
    expect(ledger.familyBalance(familyId).owedCents).toBe(10000);
    // Original payment row is untouched; a negative reversal row was added.
    expect(app.dbmod.db.select().from(payments).all()).toHaveLength(2);
    // Reversing a reversal is refused.
    expect(() => ledger.reversePayment(app.dbmod.db.select().from(payments).all().find((x) => x.reversalOf)!.id, ACTOR)).toThrow();
  });

  it('records every channel', () => {
    const { familyId } = famWithInvoice(100000, '2026-07-01');
    const channels: PaymentChannel[] = ['cash', 'zelle', 'check', 'other', 'donations-web', 'kiosk', 'portal', 'autopay'];
    channels.forEach((c, i) => ledger.recordPayment({ familyId, amountCents: 1000, channel: c, occurredAt: D('2026-07-05'), idempotencyKey: `k-${c}-${i}` }, ACTOR));
    expect(app.dbmod.db.select().from(payments).all()).toHaveLength(channels.length);
    expect(ledger.familyBalance(familyId).paidCents).toBe(channels.length * 1000);
  });

  it('a voided invoice drops out of the balance', () => {
    const { familyId, invId } = famWithInvoice(10000, '2026-07-01');
    expect(ledger.familyBalance(familyId).owedCents).toBe(10000);
    app.dbmod.db.update(invoices).set({ status: 'void' }).where(eq(invoices.id, invId)).run();
    expect(ledger.familyBalance(familyId).owedCents).toBe(0);
  });

  it('auto-allocation pays the dated invoice before an undated one (NULL due sorts last)', () => {
    // A dated, genuinely-due invoice and an undated one (dueDate NULL). Oldest-due-first must
    // settle the DATED one first — SQLite would otherwise sort NULL ahead of every date.
    const { db } = app.dbmod;
    const ts = new Date();
    db.insert(families).values({ id: 'fam_1', name: 'Fam', status: 'active', discountKind: 'none', discountValue: 0, createdAt: ts, updatedAt: ts }).run();
    const dated = mkInvoice('fam_1', 5000, '2026-07-01', 'dated');
    // An undated invoice created LATER (so createdAt can't accidentally be the tiebreaker).
    db.insert(invoices).values({ id: 'inv_undated', familyId: 'fam_1', label: 'Undated', periodKey: 'undated', dueDate: null, status: 'open', createdAt: new Date(ts.getTime() + 1000), updatedAt: ts }).run();
    db.insert(invoiceItems).values({ id: 'it_undated', invoiceId: 'inv_undated', description: 'Tuition', amountCents: 5000, studentId: null, createdAt: ts }).run();
    ledger.recordPayment({ familyId: 'fam_1', amountCents: 5000, channel: 'cash', occurredAt: D('2026-07-05'), idempotencyKey: 'k1' }, ACTOR);
    expect(invStatus(dated)).toBe('paid');
    expect(invStatus('inv_undated')).toBe('open');
  });

  it('rejects an explicit allocation that exceeds the invoice balance', () => {
    const { familyId, invId } = famWithInvoice(5000, '2026-07-01');
    expect(() => ledger.recordPayment({ familyId, amountCents: 8000, channel: 'donations-web', occurredAt: D('2026-07-05'), idempotencyKey: 'k1', allocations: [{ invoiceId: invId, amountCents: 8000 }] }, ACTOR)).toThrow('invalid_allocation');
    // Nothing was written — the transaction rolled back.
    expect(app.dbmod.db.select().from(payments).all()).toHaveLength(0);
  });

  it('rejects explicit allocations summing beyond the payment amount', () => {
    const { familyId } = famWithInvoice(5000, '2026-07-01', 'a');
    mkInvoice(familyId, 5000, '2026-08-01', 'b');
    expect(() => ledger.recordPayment({ familyId, amountCents: 6000, channel: 'kiosk', occurredAt: D('2026-07-05'), idempotencyKey: 'k1', allocations: [{ invoiceId: 'inv_a', amountCents: 5000 }, { invoiceId: 'inv_b', amountCents: 5000 }] }, ACTOR)).toThrow('invalid_allocation');
    expect(app.dbmod.db.select().from(payments).all()).toHaveLength(0);
  });

  it('rejects an explicit allocation against a voided invoice', () => {
    const { familyId, invId } = famWithInvoice(5000, '2026-07-01');
    app.dbmod.db.update(invoices).set({ status: 'void' }).where(eq(invoices.id, invId)).run();
    expect(() => ledger.recordPayment({ familyId, amountCents: 5000, channel: 'portal', occurredAt: D('2026-07-05'), idempotencyKey: 'k1', allocations: [{ invoiceId: invId, amountCents: 5000 }] }, ACTOR)).toThrow('invalid_allocation');
  });
});
