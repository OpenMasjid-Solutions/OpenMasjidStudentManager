// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/** Staff accounts — create finance users (temp password → forced change on first
 *  login), enable/disable. Admin-only. */
import { useState, type FormEvent } from 'react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { fadeRise } from '../../lib/motion';
import { trpc } from '../../lib/trpc';

const MIN_PW = 12;

export function Staff() {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const list = trpc.staff.list.useQuery();
  const create = trpc.staff.create.useMutation();
  const setStatus = trpc.staff.setStatus.useMutation();
  const [f, setF] = useState<{ username: string; displayName: string; phone: string; tempPassword: string }>({ username: '', displayName: '', phone: '', tempPassword: '' });
  const [err, setErr] = useState('');

  async function add(e: FormEvent) {
    e.preventDefault();
    setErr('');
    if (!f.username.trim() || f.tempPassword.length < MIN_PW) return setErr(t('staff.formHint'));
    try {
      await create.mutateAsync({ username: f.username.trim(), displayName: f.displayName.trim() || undefined, role: 'finance', phone: f.phone.trim() || undefined, tempPassword: f.tempPassword });
      setF({ username: '', displayName: '', phone: '', tempPassword: '' });
      await utils.staff.list.invalidate();
    } catch (e2) {
      setErr((e2 as Error).message);
    }
  }
  async function toggle(id: string, status: 'active' | 'disabled') {
    await setStatus.mutateAsync({ userId: id, status: status === 'active' ? 'disabled' : 'active' });
    await utils.staff.list.invalidate();
  }

  return (
    <motion.div className="page" variants={fadeRise} initial="initial" animate="animate">
      <div className="admin-header"><h1 className="page-title" style={{ fontSize: '1.5rem' }}>{t('staff.title')}</h1></div>
      <section className="section glass" style={{ padding: '1rem 1.1rem' }}>
        {(list.data ?? []).length === 0 ? (
          <p className="muted" style={{ fontSize: '0.9rem' }}>{t('staff.noStaff')}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead><tr><th>{t('staff.username')}</th><th>{t('staff.name')}</th><th>{t('staff.role')}</th><th>{t('directory.status')}</th><th className="actions" /></tr></thead>
              <tbody>
                {list.data?.map((u) => (
                  <tr key={u.id}>
                    <td>{u.username}{u.mustChangePassword && <span className="chip is-accent" style={{ marginInlineStart: '0.4rem' }}>{t('staff.tempPw')}</span>}</td>
                    <td>{u.displayName ?? '—'}</td>
                    <td>{t(`role.${u.role}`)}</td>
                    <td>{u.status === 'active' ? <span className="chip">{t('directory.active')}</span> : <span className="chip is-muted">{t('staff.disabled')}</span>}</td>
                    <td className="actions"><button type="button" className="btn btn--ghost btn--sm" onClick={() => toggle(u.id, u.status)} disabled={setStatus.isPending}>{u.status === 'active' ? t('staff.disable') : t('staff.enable')}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <form className="inline-form glass-inset" onSubmit={add}>
          <div className="field"><label className="label">{t('staff.username')}</label><input className="input glass-inset" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} autoComplete="off" /></div>
          <div className="field"><label className="label">{t('staff.name')}</label><input className="input glass-inset" value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} /></div>
          <div className="field"><label className="label">{t('staff.phone')}</label><input className="input glass-inset" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
          <div className="field"><label className="label">{t('staff.tempPassword')}</label><input className="input glass-inset" type="text" value={f.tempPassword} onChange={(e) => setF({ ...f, tempPassword: e.target.value })} placeholder={t('staff.tempHint')} /></div>
          <button type="submit" className="btn btn--primary" disabled={create.isPending}>{t('staff.add')}</button>
        </form>
        {err && <p className="form-error">{err}</p>}
      </section>
    </motion.div>
  );
}
