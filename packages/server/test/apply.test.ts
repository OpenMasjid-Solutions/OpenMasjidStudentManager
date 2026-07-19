// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * The anonymous public admissions form (CLAUDE.md §4, §14) — the most hostile surface. Verifies
 * the gates on POST /apply: a valid enquiry is stored as an inert `public` row; oversized/missing
 * input is rejected generically; a filled honeypot returns success but stores NOTHING; and the
 * per-IP burst limit kicks in. Driven through a real Fastify instance via inject.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { freshApp } from './harness';
import { admissions } from '../src/db/schema';

let app: Awaited<ReturnType<typeof freshApp>>;
let http: FastifyInstance;

beforeAll(async () => {
  app = await freshApp();
  const { registerApplyRoute } = await import('../src/admissions/apply');
  http = Fastify();
  registerApplyRoute(http);
  await http.ready();
});
beforeEach(() => app.dbmod.db.delete(admissions).run());

const VALID = { guardianName: 'Abu Yusuf', guardianPhone: '555-1000', guardianEmail: 'abu@example.com', childFirstName: 'Yusuf', childLastName: 'Ismail', childDob: '2016-03-01', programInterest: 'maktab' };
const post = (payload: Record<string, unknown>, ip = '203.0.113.1') =>
  http.inject({ method: 'POST', url: '/apply', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, payload: JSON.stringify(payload) });
const rows = () => app.dbmod.db.select().from(admissions).all();

describe('public /apply form', () => {
  it('stores a valid enquiry as an inert public row', async () => {
    const r = await post(VALID, '203.0.113.10');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true });
    const all = rows();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ source: 'public', status: 'enquiry', guardianName: 'Abu Yusuf', childFirstName: 'Yusuf', childLastName: 'Ismail' });
    // It can NEVER arrive pre-enrolled or with created ids.
    expect(all[0].createdFamilyId).toBeNull();
    expect(all[0].createdStudentId).toBeNull();
  });

  it('rejects oversized input generically, storing nothing', async () => {
    const r = await post({ ...VALID, guardianName: 'x'.repeat(300) }, '203.0.113.11');
    expect(r.statusCode).toBe(400);
    expect(r.json().error.message).not.toMatch(/guardianName|300|length/i); // no field/DB leak
    expect(rows()).toHaveLength(0);
  });

  it('rejects a submission missing a required field', async () => {
    const r = await post({ guardianName: 'A', childFirstName: '', childLastName: 'B' }, '203.0.113.12');
    expect(r.statusCode).toBe(400);
    expect(rows()).toHaveLength(0);
  });

  it('silently drops a bot: honeypot filled → 200 but nothing stored', async () => {
    const r = await post({ ...VALID, website: 'http://spam.example' }, '203.0.113.13');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true });
    expect(rows()).toHaveLength(0);
  });

  it('rate-limits a flood from one IP (burst cap)', async () => {
    const ip = '203.0.113.99';
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await post({ ...VALID }, ip)).statusCode);
    expect(codes.filter((c) => c === 200).length).toBeLessThanOrEqual(5); // burst cap = 5 / window
    expect(codes).toContain(429);
  });
});
