// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Stripe webhook endpoint auto-registration (CLAUDE.md §13.4) with a mocked Stripe: create + store the
 * signing secret when none exists, reclaim an endpoint already at our URL, and no-op when a secret is
 * already available (ours or the OS Fabric's). Plus the admin manual-paste fallback + status. The
 * public URL is set before freshApp (so config picks it up) and restored after (no leak to other files).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type Stripe from 'stripe';
import { freshApp, makeCtx } from './harness';
import { settings } from '../src/db/schema';
import type { Role } from '../src/db/schema';

let app: Awaited<ReturnType<typeof freshApp>>;
let we: typeof import('../src/payments/webhookEndpoint');
let settingsMod: typeof import('../src/settings');
let stripeMod: typeof import('../src/payments/stripe');
const caller = (role: Role) => app.appRouter.createCaller(makeCtx({ origin: 'lan', session: { role, source: 'local', username: role, userId: `usr_${role}` } }).ctx);

const mock = {
  listData: [] as { id: string; url: string }[],
  created: 0,
  deleted: [] as string[],
};
const fakeStripe = {
  webhookEndpoints: {
    list: async () => ({ data: mock.listData }),
    create: async (args: { url: string }) => {
      mock.created++;
      return { id: 'we_new', secret: 'whsec_generated', url: args.url };
    },
    del: async (id: string) => {
      mock.deleted.push(id);
      return { id, deleted: true };
    },
  },
};

beforeAll(async () => {
  process.env.OPENMASJID_PUBLIC_URL = 'https://masjid.test/students';
  app = await freshApp();
  we = await import('../src/payments/webhookEndpoint');
  settingsMod = await import('../src/settings');
  stripeMod = await import('../src/payments/stripe');
});
afterAll(() => {
  delete process.env.OPENMASJID_PUBLIC_URL;
});
beforeEach(() => {
  app.dbmod.db.delete(settings).run();
  mock.listData = [];
  mock.created = 0;
  mock.deleted = [];
  stripeMod._setStripeForTest({}, fakeStripe as unknown as Stripe); // fresh client, empty Fabric webhook secret
});

describe('ourWebhookUrl', () => {
  it('is the public URL + /api/stripe/webhook', () => {
    expect(we.ourWebhookUrl()).toBe('https://masjid.test/students/api/stripe/webhook');
  });
});

describe('ensureWebhookEndpoint', () => {
  it('creates the endpoint and stores the signing secret when none exists', async () => {
    await we.ensureWebhookEndpoint();
    expect(mock.created).toBe(1);
    expect(mock.deleted).toEqual([]);
    expect(settingsMod.getStripeWebhookSecret()).toBe('whsec_generated');
  });

  it('reclaims an endpoint already at our URL (delete + recreate)', async () => {
    mock.listData = [
      { id: 'we_old', url: 'https://masjid.test/students/api/stripe/webhook' },
      { id: 'we_other', url: 'https://other.example/hook' }, // different URL — left alone
    ];
    await we.ensureWebhookEndpoint();
    expect(mock.deleted).toEqual(['we_old']);
    expect(mock.created).toBe(1);
    expect(settingsMod.getStripeWebhookSecret()).toBe('whsec_generated');
  });

  it('no-ops when we already hold a stored secret', async () => {
    settingsMod.setStripeWebhookSecret('whsec_existing');
    await we.ensureWebhookEndpoint();
    expect(mock.created).toBe(0);
    expect(settingsMod.getStripeWebhookSecret()).toBe('whsec_existing');
  });

  it('no-ops when the OS Fabric already provides a webhook secret', async () => {
    stripeMod._setStripeForTest({ webhookSecret: 'whsec_from_platform' }, fakeStripe as unknown as Stripe);
    await we.ensureWebhookEndpoint();
    expect(mock.created).toBe(0);
    expect(settingsMod.getStripeWebhookSecret()).toBeNull();
  });
});

describe('settings.stripeWebhook (manual fallback)', () => {
  it('reports status + accepts a pasted secret (write-only), rejects a non-whsec value, admin-only', async () => {
    const admin = caller('admin');
    expect(await admin.settings.stripeWebhookGet()).toMatchObject({ configured: false, source: 'none', url: 'https://masjid.test/students/api/stripe/webhook' });
    await expect(admin.settings.stripeWebhookSet({ secret: 'not-a-secret' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await admin.settings.stripeWebhookSet({ secret: 'whsec_pasted' });
    expect(settingsMod.getStripeWebhookSecret()).toBe('whsec_pasted');
    const got = await admin.settings.stripeWebhookGet();
    expect(got).toMatchObject({ configured: true, source: 'stored' });
    expect(got).not.toHaveProperty('secret');
    for (const r of ['finance', 'teacher', 'parent'] as Role[]) {
      await expect(caller(r).settings.stripeWebhookGet()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
  });
});
