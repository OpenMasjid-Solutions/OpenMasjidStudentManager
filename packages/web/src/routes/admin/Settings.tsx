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

  const active = (defs.data ?? []).filter((d) => !d.archivedAt);

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
    </motion.div>
  );
}
