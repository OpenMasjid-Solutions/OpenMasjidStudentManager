// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/** Admissions pipeline (admin + finance, §4/§5): add applicants, move them through the stages,
 *  keep staff notes, and ONE-CLICK enroll (creates family + student + PIN + enrollment + optional
 *  fee/invoice). Applicant data is hostile input — React escapes it; we only ever render it as text. */
import { useState, type FormEvent } from 'react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { fadeRise, staggerContainer, staggerItem } from '../../lib/motion';
import { trpc, type RouterOutputs } from '../../lib/trpc';
import { formatMoney } from '../../lib/money';

const STAGES = ['enquiry', 'application', 'accepted', 'waitlisted', 'declined'] as const;

export function Admissions() {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const [filter, setFilter] = useState<'all' | (typeof STAGES)[number] | 'enrolled'>('all');
  const listQ = trpc.admissions.list.useQuery(filter === 'all' ? undefined : { status: filter });
  const create = trpc.admissions.create.useMutation();
  const [showNew, setShowNew] = useState(false);
  const [nw, setNw] = useState({ guardianName: '', guardianPhone: '', guardianEmail: '', childFirstName: '', childLastName: '', childDob: '', programInterest: '' });

  const refresh = () => utils.admissions.list.invalidate();

  async function submitNew(e: FormEvent) {
    e.preventDefault();
    if (!nw.guardianName.trim() || !nw.childFirstName.trim() || !nw.childLastName.trim()) return;
    await create.mutateAsync({
      guardianName: nw.guardianName.trim(), guardianPhone: nw.guardianPhone.trim() || undefined, guardianEmail: nw.guardianEmail.trim() || undefined,
      childFirstName: nw.childFirstName.trim(), childLastName: nw.childLastName.trim(), childDob: nw.childDob || undefined, programInterest: nw.programInterest.trim() || undefined,
    });
    setNw({ guardianName: '', guardianPhone: '', guardianEmail: '', childFirstName: '', childLastName: '', childDob: '', programInterest: '' });
    setShowNew(false);
    await refresh();
  }

  return (
    <motion.div className="page" variants={fadeRise} initial="initial" animate="animate">
      <div className="admin-header">
        <h1 className="page-title" style={{ fontSize: '1.5rem' }}>{t('nav.admissions')}</h1>
        <span className="spacer" style={{ marginInlineStart: 'auto' }} />
        <button type="button" className="btn btn--primary btn--sm" onClick={() => setShowNew((v) => !v)}>{t('admissions.addApplicant')}</button>
      </div>

      {showNew && (
        <section className="section glass" style={{ padding: '1rem 1.1rem' }}>
          <div className="section-head"><h2>{t('admissions.newEnquiry')}</h2></div>
          <form className="inline-form glass-inset" onSubmit={submitNew}>
            <div className="field"><label className="label">{t('admissions.guardianName')}</label><input className="input glass-inset" value={nw.guardianName} onChange={(e) => setNw({ ...nw, guardianName: e.target.value })} /></div>
            <div className="field"><label className="label">{t('admissions.phone')}</label><input className="input glass-inset" value={nw.guardianPhone} onChange={(e) => setNw({ ...nw, guardianPhone: e.target.value })} /></div>
            <div className="field"><label className="label">{t('admissions.email')}</label><input className="input glass-inset" value={nw.guardianEmail} onChange={(e) => setNw({ ...nw, guardianEmail: e.target.value })} /></div>
            <div className="field"><label className="label">{t('admissions.childFirst')}</label><input className="input glass-inset" value={nw.childFirstName} onChange={(e) => setNw({ ...nw, childFirstName: e.target.value })} /></div>
            <div className="field"><label className="label">{t('admissions.childLast')}</label><input className="input glass-inset" value={nw.childLastName} onChange={(e) => setNw({ ...nw, childLastName: e.target.value })} /></div>
            <div className="field" style={{ flex: '0 1 10rem' }}><label className="label">{t('admissions.dob')}</label><input type="date" className="input glass-inset" value={nw.childDob} onChange={(e) => setNw({ ...nw, childDob: e.target.value })} /></div>
            <div className="field"><label className="label">{t('admissions.program')}</label><input className="input glass-inset" value={nw.programInterest} onChange={(e) => setNw({ ...nw, programInterest: e.target.value })} /></div>
            <button type="submit" className="btn btn--primary" disabled={create.isPending}>{t('common.save')}</button>
          </form>
        </section>
      )}

      <div className="chip-row" style={{ margin: '0.25rem 0 0.75rem' }}>
        {(['all', ...STAGES, 'enrolled'] as const).map((s) => (
          <button key={s} type="button" className={`chip ${filter === s ? 'is-accent' : ''}`} onClick={() => setFilter(s)}>
            {s === 'all' ? t('admissions.all') : t(`admissions.st_${s}`)}
          </button>
        ))}
      </div>

      {(listQ.data ?? []).length === 0 ? (
        <p className="empty">{t('admissions.none')}</p>
      ) : (
        <motion.div variants={staggerContainer} initial="initial" animate="animate" style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          {listQ.data?.map((a) => <ApplicantCard key={a.id} a={a} onChanged={refresh} />)}
        </motion.div>
      )}
    </motion.div>
  );
}

type Applicant = RouterOutputs['admissions']['list'][number];

function ApplicantCard({ a, onChanged }: { a: Applicant; onChanged: () => Promise<unknown> }) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const setStatus = trpc.admissions.setStatus.useMutation();
  const remove = trpc.admissions.remove.useMutation();
  const [open, setOpen] = useState<null | 'notes' | 'enroll'>(null);
  const enrolled = a.status === 'enrolled';

  return (
    <motion.div className="section glass" variants={staggerItem} style={{ padding: '0.85rem 1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{a.childFirstName} {a.childLastName}</div>
          <div className="muted" style={{ fontSize: '0.85rem' }}>
            {a.guardianName}{a.guardianPhone ? ` · ${a.guardianPhone}` : ''}{a.guardianEmail ? ` · ${a.guardianEmail}` : ''}{a.programInterest ? ` · ${a.programInterest}` : ''}
          </div>
        </div>
        <span className="spacer" style={{ marginInlineStart: 'auto' }} />
        {a.source === 'public' && <span className="chip">{t('admissions.fromPublic')}</span>}
        {enrolled ? (
          <span className="chip is-accent">{t('admissions.st_enrolled')}</span>
        ) : (
          <select className="input glass-inset" style={{ width: 'auto' }} value={a.status} onChange={async (e) => { await setStatus.mutateAsync({ id: a.id, status: e.target.value as (typeof STAGES)[number] }); await onChanged(); }}>
            {STAGES.map((s) => <option key={s} value={s}>{t(`admissions.st_${s}`)}</option>)}
          </select>
        )}
        {!enrolled && <button type="button" className="btn btn--primary btn--sm" onClick={() => setOpen(open === 'enroll' ? null : 'enroll')}>{t('admissions.enroll')}</button>}
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => { setOpen(open === 'notes' ? null : 'notes'); if (open !== 'notes') void utils.admissions.notesFor.invalidate({ admissionId: a.id }); }}>{t('admissions.notes')}</button>
        {!enrolled && <button type="button" className="btn btn--ghost btn--sm" onClick={async () => { if (!window.confirm(t('admissions.confirmRemove'))) return; await remove.mutateAsync({ id: a.id }); await onChanged(); }}>{t('common.remove')}</button>}
      </div>

      {open === 'notes' && <NotesPanel admissionId={a.id} />}
      {open === 'enroll' && !enrolled && <EnrollPanel admissionId={a.id} onDone={async () => { setOpen(null); await onChanged(); }} />}
    </motion.div>
  );
}

function NotesPanel({ admissionId }: { admissionId: string }) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const notesQ = trpc.admissions.notesFor.useQuery({ admissionId });
  const add = trpc.admissions.addNote.useMutation();
  const [text, setText] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    await add.mutateAsync({ admissionId, note: text.trim() });
    setText('');
    await utils.admissions.notesFor.invalidate({ admissionId });
  }
  return (
    <div className="glass-inset" style={{ marginBlockStart: '0.6rem', padding: '0.6rem 0.75rem', borderRadius: 'var(--radius-button)' }}>
      <form className="inline-form" style={{ padding: 0, marginBlockEnd: '0.5rem' }} onSubmit={submit}>
        <div className="field" style={{ flex: 1 }}><input className="input glass-inset" placeholder={t('admissions.addNote')} value={text} onChange={(e) => setText(e.target.value)} /></div>
        <button type="submit" className="btn btn--primary btn--sm" disabled={add.isPending}>{t('common.add')}</button>
      </form>
      {(notesQ.data ?? []).map((n) => (
        <div key={n.id} style={{ fontSize: '0.85rem', padding: '0.25rem 0' }}>
          <span>{n.note}</span> <span className="muted">— {n.by ?? '—'}</span>
        </div>
      ))}
      {notesQ.data && notesQ.data.length === 0 && <p className="muted" style={{ fontSize: '0.85rem' }}>{t('admissions.noNotes')}</p>}
    </div>
  );
}

function EnrollPanel({ admissionId, onDone }: { admissionId: string; onDone: () => Promise<void> }) {
  const { t } = useTranslation();
  const classesQ = trpc.admissions.classesForEnroll.useQuery();
  const plansQ = trpc.billing.feePlanList.useQuery();
  const currencyQ = trpc.billing.currency.useQuery();
  const enroll = trpc.admissions.enroll.useMutation();
  const [classId, setClassId] = useState('');
  const [feePlanId, setFeePlanId] = useState('');
  const [genInvoice, setGenInvoice] = useState(false);
  const [inv, setInv] = useState({ periodKey: '', label: '', dueDate: '' });
  const [result, setResult] = useState<{ pin: string; invoicePending: boolean } | null>(null);
  const [error, setError] = useState('');
  const currency = currencyQ.data?.currency ?? 'usd';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!classId) return setError(t('admissions.pickClass'));
    if (genInvoice && (!feePlanId || !inv.periodKey.trim() || !inv.label.trim())) return setError(t('admissions.invoiceNeedsFee'));
    try {
      const r = await enroll.mutateAsync({
        admissionId, classId, feePlanId: feePlanId || undefined,
        invoice: genInvoice && feePlanId ? { periodKey: inv.periodKey.trim(), label: inv.label.trim(), dueDate: inv.dueDate || undefined } : undefined,
      });
      setResult({ pin: r.pin, invoicePending: r.invoicePending });
      await onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (result) return <div className="notice notice--ok" style={{ marginBlockStart: '0.6rem' }}>{t(result.invoicePending ? 'admissions.enrolledInvoicePending' : 'admissions.enrolledOk', { pin: result.pin })}</div>;

  return (
    <form className="glass-inset" style={{ marginBlockStart: '0.6rem', padding: '0.6rem 0.75rem', borderRadius: 'var(--radius-button)', display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end' }} onSubmit={submit}>
      <div className="field" style={{ flex: '1 1 12rem' }}>
        <label className="label">{t('admissions.class')}</label>
        <select className="input glass-inset" value={classId} onChange={(e) => setClassId(e.target.value)}>
          <option value="">—</option>
          {classesQ.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div className="field" style={{ flex: '1 1 10rem' }}>
        <label className="label">{t('admissions.feePlan')}</label>
        <select className="input glass-inset" value={feePlanId} onChange={(e) => setFeePlanId(e.target.value)}>
          <option value="">{t('admissions.noFee')}</option>
          {plansQ.data?.map((p) => <option key={p.id} value={p.id}>{p.name} · {formatMoney(p.amountCents, currency)}</option>)}
        </select>
      </div>
      <label className="hint" style={{ display: 'inline-flex', gap: '0.35rem', alignItems: 'center', flexBasis: '100%' }}>
        <input type="checkbox" checked={genInvoice} onChange={(e) => setGenInvoice(e.target.checked)} disabled={!feePlanId} /> {t('admissions.genFirstInvoice')}
      </label>
      {genInvoice && (
        <>
          <div className="field"><label className="label">{t('billing.periodKey')}</label><input className="input glass-inset" value={inv.periodKey} onChange={(e) => setInv({ ...inv, periodKey: e.target.value })} placeholder="2026-07" /></div>
          <div className="field"><label className="label">{t('billing.label')}</label><input className="input glass-inset" value={inv.label} onChange={(e) => setInv({ ...inv, label: e.target.value })} /></div>
          <div className="field" style={{ flex: '0 1 10rem' }}><label className="label">{t('billing.due')}</label><input type="date" className="input glass-inset" value={inv.dueDate} onChange={(e) => setInv({ ...inv, dueDate: e.target.value })} /></div>
        </>
      )}
      {error && <p className="form-error" style={{ flexBasis: '100%' }}>{error}</p>}
      <button type="submit" className="btn btn--primary" disabled={enroll.isPending}>{t('admissions.enrollNow')}</button>
    </form>
  );
}
