// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/** Admin settings — custom student fields (define once, apply to every student).
 *  More settings (SMTP, Stripe, scales, merit categories…) join here in later slices. */
import { useState, type FormEvent } from 'react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { fadeRise } from '../../lib/motion';
import { trpc } from '../../lib/trpc';

type FieldType = 'text' | 'number' | 'date' | 'select';

export function Settings() {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const defs = trpc.records.fieldDefsList.useQuery();
  const create = trpc.records.fieldDefCreate.useMutation();
  const archive = trpc.records.fieldDefArchive.useMutation();
  const [f, setF] = useState<{ label: string; type: FieldType; options: string }>({ label: '', type: 'text', options: '' });

  // App settings (school name, currency, report-card merit toggle)
  const appSettings = trpc.settings.get.useQuery();
  const saveSettings = trpc.settings.set.useMutation();
  const [school, setSchool] = useState<{ schoolName: string; currency: string } | null>(null);
  const eff = school ?? (appSettings.data ? { schoolName: appSettings.data.schoolName, currency: appSettings.data.currency } : { schoolName: '', currency: 'usd' });

  async function saveSchool() {
    await saveSettings.mutateAsync({ schoolName: eff.schoolName.trim(), currency: eff.currency as 'usd' | 'cad' | 'gbp' | 'eur' });
    await utils.settings.get.invalidate();
    setSchool(null);
  }
  async function toggleMerit() {
    await saveSettings.mutateAsync({ meritOnReportCard: !appSettings.data?.meritOnReportCard });
    await utils.settings.get.invalidate();
  }

  // Email (SMTP) — the password is write-only: never returned by smtpGet; only sent when re-typed.
  const smtp = trpc.settings.smtpGet.useQuery();
  const saveSmtp = trpc.settings.smtpSet.useMutation();
  const testSmtp = trpc.settings.smtpTest.useMutation();
  const [smtpForm, setSmtpForm] = useState<{ host: string; port: string; secure: boolean; user: string; from: string; password: string } | null>(null);
  const [testTo, setTestTo] = useState('');
  const [smtpMsg, setSmtpMsg] = useState<string | null>(null);
  const se = smtpForm ?? (smtp.data ? { host: smtp.data.host, port: String(smtp.data.port), secure: smtp.data.secure, user: smtp.data.user, from: smtp.data.from, password: '' } : { host: '', port: '587', secure: false, user: '', from: '', password: '' });

  async function saveSmtpSettings() {
    const port = parseInt(se.port, 10);
    if (!se.host.trim() || !se.from.trim() || Number.isNaN(port)) return;
    await saveSmtp.mutateAsync({ host: se.host.trim(), port, secure: se.secure, user: se.user.trim(), from: se.from.trim(), password: se.password || undefined });
    await utils.settings.smtpGet.invalidate();
    setSmtpForm(null);
    setSmtpMsg(t('settings.smtpSaved'));
  }
  async function runSmtpTest() {
    setSmtpMsg(null);
    try {
      await testSmtp.mutateAsync({ to: testTo.trim() });
      setSmtpMsg(t('settings.smtpTestOk'));
    } catch (e) {
      setSmtpMsg((e as Error).message);
    }
  }

  // Payments — Stripe webhook signing secret (§13.4): status + manual-paste fallback.
  const stripeWebhook = trpc.settings.stripeWebhookGet.useQuery();
  const saveWebhook = trpc.settings.stripeWebhookSet.useMutation();
  const [whSecret, setWhSecret] = useState('');
  const [whMsg, setWhMsg] = useState<string | null>(null);
  async function saveWebhookSecret() {
    setWhMsg(null);
    try {
      await saveWebhook.mutateAsync({ secret: whSecret.trim() });
      setWhSecret('');
      setWhMsg(t('settings.webhookSaved'));
      await utils.settings.stripeWebhookGet.invalidate();
    } catch (e) {
      setWhMsg((e as Error).message);
    }
  }

  // Shared comment bank
  const snippets = trpc.comments.list.useQuery();
  const snipCreate = trpc.comments.create.useMutation();
  const snipRemove = trpc.comments.remove.useMutation();
  const [newSnippet, setNewSnippet] = useState('');
  async function addSharedSnippet(e: FormEvent) {
    e.preventDefault();
    if (!newSnippet.trim()) return;
    await snipCreate.mutateAsync({ scope: 'shared', text: newSnippet.trim() });
    setNewSnippet('');
    await utils.comments.list.invalidate();
  }
  async function removeSharedSnippet(id: string) {
    await snipRemove.mutateAsync({ id });
    await utils.comments.list.invalidate();
  }

  // Merit categories
  const meritCats = trpc.merit.categoryList.useQuery();
  const meritCreate = trpc.merit.categoryCreate.useMutation();
  const meritUpdate = trpc.merit.categoryUpdate.useMutation();
  const meritArchive = trpc.merit.categoryArchive.useMutation();
  const [mc, setMc] = useState<{ name: string; points: string }>({ name: '', points: '5' });

  const active = (defs.data ?? []).filter((d) => !d.archivedAt);

  async function addMerit(e: FormEvent) {
    e.preventDefault();
    const pts = parseInt(mc.points, 10);
    if (!mc.name.trim() || Number.isNaN(pts)) return;
    await meritCreate.mutateAsync({ name: mc.name.trim(), defaultPoints: pts });
    setMc({ name: '', points: '5' });
    await utils.merit.categoryList.invalidate();
  }
  async function saveMeritPoints(id: string, raw: string, original: number) {
    const pts = parseInt(raw, 10);
    if (Number.isNaN(pts) || pts === original) return;
    await meritUpdate.mutateAsync({ id, defaultPoints: pts });
    await utils.merit.categoryList.invalidate();
  }
  async function removeMerit(id: string) {
    await meritArchive.mutateAsync({ id });
    await utils.merit.categoryList.invalidate();
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!f.label.trim()) return;
    const options = f.type === 'select' ? f.options.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
    if (f.type === 'select' && (!options || options.length === 0)) return;
    await create.mutateAsync({ label: f.label.trim(), type: f.type, options });
    setF({ label: '', type: 'text', options: '' });
    await utils.records.fieldDefsList.invalidate();
  }
  async function remove(id: string) {
    await archive.mutateAsync({ id });
    await utils.records.fieldDefsList.invalidate();
  }

  return (
    <motion.div className="page" variants={fadeRise} initial="initial" animate="animate">
      <div className="admin-header">
        <h1 className="page-title" style={{ fontSize: '1.5rem' }}>{t('settings.title')}</h1>
      </div>

      {/* School */}
      <section className="section glass" style={{ padding: '1rem 1.1rem' }}>
        <div className="section-head"><h2>{t('settings.school')}</h2></div>
        <p className="muted" style={{ fontSize: '0.88rem', marginBlockEnd: '0.75rem' }}>{t('settings.schoolHint')}</p>
        {!appSettings.data ? (
          <p className="muted" style={{ fontSize: '0.9rem' }}>{t('common.loading')}</p>
        ) : (
          <>
            <div className="inline-form glass-inset" style={{ marginBlockStart: 0 }}>
              <div className="field" style={{ flex: '2 1 16rem' }}><label className="label">{t('settings.schoolName')}</label><input className="input glass-inset" value={eff.schoolName} onChange={(e) => setSchool({ ...eff, schoolName: e.target.value })} /></div>
              <div className="field" style={{ flex: '0 1 8rem' }}><label className="label">{t('settings.currency')}</label>
                <select className="input glass-inset" value={eff.currency} onChange={(e) => setSchool({ ...eff, currency: e.target.value })}>
                  {['usd', 'cad', 'gbp', 'eur'].map((c) => <option key={c} value={c}>{c.toUpperCase()}</option>)}
                </select>
              </div>
              <button type="button" className="btn btn--primary" onClick={saveSchool} disabled={saveSettings.isPending || !eff.schoolName.trim()}>{t('common.save')}</button>
            </div>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', marginBlockStart: '0.75rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={!!appSettings.data.meritOnReportCard} onChange={toggleMerit} />
              <span>{t('settings.meritOnReportCard')}</span>
            </label>
          </>
        )}
      </section>

      {/* Email (SMTP) — optional but recommended: powers parent invites, receipts, and autopay notices. */}
      <section className="section glass" style={{ padding: '1rem 1.1rem' }}>
        <div className="section-head"><h2>{t('settings.smtp')}</h2></div>
        <p className="muted" style={{ fontSize: '0.88rem', marginBlockEnd: '0.75rem' }}>{t('settings.smtpHint')}</p>
        {smtpMsg && <div className="notice notice--warn" style={{ marginBlockEnd: '0.6rem' }}>{smtpMsg}</div>}
        <div className="inline-form glass-inset" style={{ marginBlockStart: 0 }}>
          <div className="field" style={{ flex: '2 1 14rem' }}><label className="label">{t('settings.smtpHost')}</label><input className="input glass-inset" value={se.host} onChange={(e) => setSmtpForm({ ...se, host: e.target.value })} placeholder="smtp.example.org" /></div>
          <div className="field" style={{ flex: '0 1 6rem' }}><label className="label">{t('settings.smtpPort')}</label><input type="number" className="input glass-inset" value={se.port} onChange={(e) => setSmtpForm({ ...se, port: e.target.value })} /></div>
          <div className="field" style={{ flex: '1 1 15rem' }}><label className="label">{t('settings.smtpFrom')}</label><input className="input glass-inset" value={se.from} onChange={(e) => setSmtpForm({ ...se, from: e.target.value })} placeholder="School <office@example.org>" /></div>
          <div className="field" style={{ flex: '1 1 10rem' }}><label className="label">{t('settings.smtpUser')}</label><input className="input glass-inset" value={se.user} onChange={(e) => setSmtpForm({ ...se, user: e.target.value })} autoComplete="off" /></div>
          <div className="field" style={{ flex: '1 1 10rem' }}><label className="label">{t('settings.smtpPassword')}</label><input type="password" className="input glass-inset" value={se.password} onChange={(e) => setSmtpForm({ ...se, password: e.target.value })} placeholder={smtp.data?.hasPassword ? t('settings.smtpPasswordSet') : ''} autoComplete="new-password" /></div>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', alignSelf: 'center' }}>
            <input type="checkbox" checked={se.secure} onChange={(e) => setSmtpForm({ ...se, secure: e.target.checked })} />
            <span>{t('settings.smtpSecure')}</span>
          </label>
          <button type="button" className="btn btn--primary" onClick={saveSmtpSettings} disabled={saveSmtp.isPending || !se.host.trim() || !se.from.trim()}>{t('common.save')}</button>
        </div>
        <div className="inline-form glass-inset" style={{ marginBlockStart: '0.6rem' }}>
          <div className="field" style={{ flex: '1 1 14rem' }}><label className="label">{t('settings.smtpTestTo')}</label><input className="input glass-inset" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@example.org" /></div>
          <button type="button" className="btn btn--ghost" onClick={runSmtpTest} disabled={testSmtp.isPending || !testTo.trim() || !smtp.data?.configured}>{testSmtp.isPending ? t('settings.smtpTesting') : t('settings.smtpSendTest')}</button>
        </div>
      </section>

      {/* Payments — Stripe webhook (auto-registered when possible; this is the status + manual fallback). */}
      <section className="section glass" style={{ padding: '1rem 1.1rem' }}>
        <div className="section-head"><h2>{t('settings.payments')}</h2></div>
        <p className="muted" style={{ fontSize: '0.88rem', marginBlockEnd: '0.75rem' }}>{t('settings.paymentsHint')}</p>
        {whMsg && <div className="notice notice--warn" style={{ marginBlockEnd: '0.6rem' }}>{whMsg}</div>}
        <p className="muted" style={{ fontSize: '0.9rem', marginBlockEnd: '0.5rem' }}>
          {stripeWebhook.data?.configured ? t(stripeWebhook.data.source === 'platform' ? 'settings.webhookOkPlatform' : 'settings.webhookOk') : t('settings.webhookNone')}
        </p>
        {stripeWebhook.data?.url && (
          <div className="field" style={{ marginBlockEnd: '0.5rem' }}>
            <label className="label">{t('settings.webhookUrl')}</label>
            <input className="input glass-inset" readOnly value={stripeWebhook.data.url} onFocus={(e) => e.currentTarget.select()} />
          </div>
        )}
        <div className="inline-form glass-inset" style={{ marginBlockStart: 0 }}>
          <div className="field" style={{ flex: '1 1 16rem' }}><label className="label">{t('settings.webhookSecret')}</label><input type="password" className="input glass-inset" value={whSecret} onChange={(e) => setWhSecret(e.target.value)} placeholder="whsec_…" autoComplete="off" /></div>
          <button type="button" className="btn btn--primary" onClick={saveWebhookSecret} disabled={saveWebhook.isPending || !whSecret.trim()}>{t('common.save')}</button>
        </div>
      </section>

      <section className="section glass" style={{ padding: '1rem 1.1rem' }}>
        <div className="section-head"><h2>{t('settings.customFields')}</h2></div>
        <p className="muted" style={{ fontSize: '0.88rem', marginBlockEnd: '0.75rem' }}>{t('settings.customFieldsHint')}</p>

        {active.length === 0 ? (
          <p className="muted" style={{ fontSize: '0.9rem' }}>{t('settings.noFields')}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr><th>{t('settings.fieldLabel')}</th><th>{t('settings.fieldType')}</th><th className="actions" /></tr>
              </thead>
              <tbody>
                {active.map((d) => (
                  <tr key={d.id}>
                    <td>{d.label}</td>
                    <td>{t(`ftype.${d.type}`)}{d.type === 'select' && d.options ? ` (${d.options.join(', ')})` : ''}</td>
                    <td className="actions"><button type="button" className="btn btn--ghost btn--sm" onClick={() => remove(d.id)} disabled={archive.isPending}>{t('settings.archive')}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <form className="inline-form glass-inset" onSubmit={add}>
          <div className="field"><label className="label">{t('settings.fieldLabel')}</label><input className="input glass-inset" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /></div>
          <div className="field">
            <label className="label">{t('settings.fieldType')}</label>
            <select className="input glass-inset" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as FieldType })}>
              {(['text', 'number', 'date', 'select'] as const).map((ty) => <option key={ty} value={ty}>{t(`ftype.${ty}`)}</option>)}
            </select>
          </div>
          {f.type === 'select' && (
            <div className="field" style={{ flex: '1 1 100%' }}>
              <label className="label">{t('settings.options')}</label>
              <input className="input glass-inset" value={f.options} onChange={(e) => setF({ ...f, options: e.target.value })} placeholder={t('settings.optionsHint')} />
            </div>
          )}
          <button type="submit" className="btn btn--primary" disabled={create.isPending}>{t('settings.addField')}</button>
        </form>
      </section>

      {/* Merit categories */}
      <section className="section glass" style={{ padding: '1rem 1.1rem' }}>
        <div className="section-head"><h2>{t('settings.meritCategories')}</h2></div>
        <p className="muted" style={{ fontSize: '0.88rem', marginBlockEnd: '0.75rem' }}>{t('settings.meritCategoriesHint')}</p>

        {(meritCats.data ?? []).length === 0 ? (
          <p className="muted" style={{ fontSize: '0.9rem' }}>{t('settings.noMeritCategories')}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead><tr><th>{t('settings.categoryName')}</th><th>{t('settings.defaultPoints')}</th><th className="actions" /></tr></thead>
              <tbody>
                {(meritCats.data ?? []).map((c) => (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td><input type="number" className="input glass-inset" style={{ width: '4.5rem', padding: '0.3rem 0.4rem', textAlign: 'center' }} defaultValue={c.defaultPoints} key={`${c.id}|${c.defaultPoints}`} onBlur={(e) => saveMeritPoints(c.id, e.target.value, c.defaultPoints)} /></td>
                    <td className="actions"><button type="button" className="btn btn--ghost btn--sm" onClick={() => removeMerit(c.id)} disabled={meritArchive.isPending}>{t('settings.archive')}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <form className="inline-form glass-inset" onSubmit={addMerit}>
          <div className="field"><label className="label">{t('settings.categoryName')}</label><input className="input glass-inset" value={mc.name} onChange={(e) => setMc({ ...mc, name: e.target.value })} /></div>
          <div className="field" style={{ flex: '0 1 7rem' }}><label className="label">{t('settings.defaultPoints')}</label><input type="number" className="input glass-inset" value={mc.points} onChange={(e) => setMc({ ...mc, points: e.target.value })} /></div>
          <button type="submit" className="btn btn--primary" disabled={meritCreate.isPending}>{t('settings.addCategory')}</button>
        </form>
      </section>

      {/* Shared comment bank */}
      <section className="section glass" style={{ padding: '1rem 1.1rem' }}>
        <div className="section-head"><h2>{t('settings.commentBank')}</h2></div>
        <p className="muted" style={{ fontSize: '0.88rem', marginBlockEnd: '0.75rem' }}>{t('settings.commentBankHint')}</p>
        {(snippets.data?.shared ?? []).length === 0 ? (
          <p className="muted" style={{ fontSize: '0.9rem' }}>{t('settings.noSnippets')}</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            {snippets.data?.shared.map((s) => (
              <div key={s.id} className="glass-inset" style={{ padding: '0.5rem 0.75rem', borderRadius: 'var(--radius-button)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ flex: 1 }}>{s.text}</span>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => removeSharedSnippet(s.id)} disabled={snipRemove.isPending}>{t('settings.archive')}</button>
              </div>
            ))}
          </div>
        )}
        <form className="inline-form glass-inset" onSubmit={addSharedSnippet}>
          <div className="field" style={{ flex: '1 1 100%' }}><label className="label">{t('settings.snippet')}</label><input className="input glass-inset" value={newSnippet} onChange={(e) => setNewSnippet(e.target.value)} placeholder={t('settings.snippetHint')} /></div>
          <button type="submit" className="btn btn--primary" disabled={snipCreate.isPending}>{t('settings.addSnippet')}</button>
        </form>
      </section>
    </motion.div>
  );
}
