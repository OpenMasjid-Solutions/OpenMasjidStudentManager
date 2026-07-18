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
