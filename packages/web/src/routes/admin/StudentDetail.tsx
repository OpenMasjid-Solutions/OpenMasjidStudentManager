// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/** One student's record: custom fields (typed), staff notes (activity log), and
 *  incident/disciplinary records (with the per-incident "visible to parents" toggle,
 *  default OFF). Admin-only screen. */
import { useState, useEffect, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { trpc } from '../../lib/trpc';

interface StudentLite {
  id: string;
  firstName: string;
  lastName: string;
  pin: string;
  status: 'active' | 'withdrawn';
}

export function StudentDetail({ student }: { student: StudentLite }) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const studentId = student.id;

  const defs = trpc.records.fieldDefsList.useQuery();
  const values = trpc.records.fieldValuesForStudent.useQuery({ studentId });
  const notes = trpc.records.notesForStudent.useQuery({ studentId });
  const incidentsQ = trpc.records.incidentsForStudent.useQuery({ studentId });

  const setValue = trpc.records.fieldValueSet.useMutation();
  const addNote = trpc.records.noteAdd.useMutation();
  const addIncident = trpc.records.incidentAdd.useMutation();
  const setVisibility = trpc.records.incidentSetVisibility.useMutation();

  const activeDefs = (defs.data ?? []).filter((d) => !d.archivedAt);
  const [fieldEdits, setFieldEdits] = useState<Record<string, string>>({});
  useEffect(() => {
    const map: Record<string, string> = {};
    for (const v of values.data ?? []) map[v.defId] = v.value;
    setFieldEdits(map);
  }, [values.data]);

  const [noteBody, setNoteBody] = useState('');
  const [showInc, setShowInc] = useState(false);
  const [inc, setInc] = useState({ date: new Date().toISOString().slice(0, 10), category: '', description: '', actionTaken: '', visibleToParents: false });

  async function saveFields() {
    const current = new Map((values.data ?? []).map((v) => [v.defId, v.value]));
    for (const d of activeDefs) {
      const next = (fieldEdits[d.id] ?? '').trim();
      if (next !== (current.get(d.id) ?? '')) {
        await setValue.mutateAsync({ studentId, defId: d.id, value: next });
      }
    }
    await utils.records.fieldValuesForStudent.invalidate({ studentId });
  }
  async function submitNote(e: FormEvent) {
    e.preventDefault();
    if (!noteBody.trim()) return;
    await addNote.mutateAsync({ studentId, body: noteBody.trim() });
    setNoteBody('');
    await utils.records.notesForStudent.invalidate({ studentId });
  }
  async function submitIncident(e: FormEvent) {
    e.preventDefault();
    if (!inc.category.trim() || !inc.description.trim()) return;
    await addIncident.mutateAsync({ studentId, date: inc.date, category: inc.category.trim(), description: inc.description.trim(), actionTaken: inc.actionTaken.trim() || undefined, visibleToParents: inc.visibleToParents });
    setInc({ date: new Date().toISOString().slice(0, 10), category: '', description: '', actionTaken: '', visibleToParents: false });
    setShowInc(false);
    await utils.records.incidentsForStudent.invalidate({ studentId });
  }
  async function toggleVisibility(id: string, to: boolean) {
    await setVisibility.mutateAsync({ id, visibleToParents: to });
    await utils.records.incidentsForStudent.invalidate({ studentId });
  }

  const fmtDate = (ms: number) => new Date(ms).toLocaleDateString();

  return (
    <div className="win-content">
      <div className="admin-header" style={{ marginBlockEnd: '1rem' }}>
        <span className="muted">{t('directory.pin')}</span>
        <span className="pin" style={{ marginInlineStart: '0.5rem' }}>{student.pin}</span>
        {student.status === 'withdrawn' && <span className="chip is-muted" style={{ marginInlineStart: '0.75rem' }}>{t('directory.withdrawn')}</span>}
      </div>

      {/* Custom fields */}
      <section className="section glass" style={{ padding: '1rem 1.1rem' }}>
        <div className="section-head"><h2>{t('student.customFields')}</h2></div>
        {activeDefs.length === 0 ? (
          <p className="muted" style={{ fontSize: '0.9rem' }}>{t('student.noFields')}</p>
        ) : (
          <>
            <div className="inline-form" style={{ padding: 0 }}>
              {activeDefs.map((d) => (
                <div className="field" key={d.id}>
                  <label className="label">{d.label}</label>
                  {d.type === 'select' ? (
                    <select className="input glass-inset" value={fieldEdits[d.id] ?? ''} onChange={(e) => setFieldEdits({ ...fieldEdits, [d.id]: e.target.value })}>
                      <option value="">—</option>
                      {(d.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input
                      className="input glass-inset"
                      type={d.type === 'number' ? 'number' : d.type === 'date' ? 'date' : 'text'}
                      value={fieldEdits[d.id] ?? ''}
                      onChange={(e) => setFieldEdits({ ...fieldEdits, [d.id]: e.target.value })}
                    />
                  )}
                </div>
              ))}
            </div>
            <button type="button" className="btn btn--primary btn--sm" style={{ marginBlockStart: '0.75rem' }} onClick={saveFields} disabled={setValue.isPending}>
              {t('common.save')}
            </button>
          </>
        )}
      </section>

      {/* Notes */}
      <section className="section glass" style={{ padding: '1rem 1.1rem' }}>
        <div className="section-head"><h2>{t('student.notes')}</h2></div>
        {(notes.data ?? []).length === 0 ? (
          <p className="muted" style={{ fontSize: '0.9rem' }}>{t('student.noNotes')}</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {notes.data?.map((n) => (
              <div key={n.id} className="glass-inset" style={{ padding: '0.6rem 0.8rem', borderRadius: 'var(--radius-button)' }}>
                <div style={{ whiteSpace: 'pre-wrap' }}>{n.body}</div>
                <div className="muted" style={{ fontSize: '0.78rem', marginBlockStart: '0.3rem' }}>{n.authorName ?? '—'} · {fmtDate(n.createdAt as unknown as number)}</div>
              </div>
            ))}
          </div>
        )}
        <form className="inline-form glass-inset" onSubmit={submitNote}>
          <div className="field" style={{ flex: '1 1 100%' }}>
            <label className="label">{t('student.addNote')}</label>
            <input className="input glass-inset" value={noteBody} onChange={(e) => setNoteBody(e.target.value)} placeholder={t('student.notePlaceholder')} />
          </div>
          <button type="submit" className="btn btn--primary" disabled={addNote.isPending}>{t('common.save')}</button>
        </form>
      </section>

      {/* Incidents */}
      <section className="section glass" style={{ padding: '1rem 1.1rem' }}>
        <div className="section-head">
          <h2>{t('student.incidents')}</h2>
          <span className="spacer" />
          <button type="button" className="btn btn--primary btn--sm" onClick={() => setShowInc((v) => !v)}>{t('student.addIncident')}</button>
        </div>
        {(incidentsQ.data ?? []).length === 0 ? (
          <p className="muted" style={{ fontSize: '0.9rem' }}>{t('student.noIncidents')}</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {incidentsQ.data?.map((i) => (
              <div key={i.id} className="glass-inset" style={{ padding: '0.6rem 0.8rem', borderRadius: 'var(--radius-button)' }}>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <strong>{i.category}</strong>
                  <span className="muted">· {i.date}</span>
                  <span className="spacer" style={{ flex: 1 }} />
                  <label className="hint" style={{ display: 'inline-flex', gap: '0.35rem', alignItems: 'center' }}>
                    <input type="checkbox" checked={i.visibleToParents} onChange={(e) => toggleVisibility(i.id, e.target.checked)} /> {t('student.visibleToParents')}
                  </label>
                </div>
                <div style={{ whiteSpace: 'pre-wrap', marginBlockStart: '0.3rem' }}>{i.description}</div>
                {i.actionTaken && <div className="muted" style={{ fontSize: '0.85rem', marginBlockStart: '0.3rem' }}>{t('student.action')}: {i.actionTaken}</div>}
              </div>
            ))}
          </div>
        )}
        {showInc && (
          <form className="inline-form glass-inset" onSubmit={submitIncident}>
            <div className="field"><label className="label">{t('student.date')}</label><input type="date" className="input glass-inset" value={inc.date} onChange={(e) => setInc({ ...inc, date: e.target.value })} /></div>
            <div className="field"><label className="label">{t('student.category')}</label><input className="input glass-inset" value={inc.category} onChange={(e) => setInc({ ...inc, category: e.target.value })} /></div>
            <div className="field" style={{ flex: '1 1 100%' }}><label className="label">{t('student.description')}</label><input className="input glass-inset" value={inc.description} onChange={(e) => setInc({ ...inc, description: e.target.value })} /></div>
            <div className="field" style={{ flex: '1 1 100%' }}><label className="label">{t('student.action')}</label><input className="input glass-inset" value={inc.actionTaken} onChange={(e) => setInc({ ...inc, actionTaken: e.target.value })} /></div>
            <label className="hint" style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center' }}>
              <input type="checkbox" checked={inc.visibleToParents} onChange={(e) => setInc({ ...inc, visibleToParents: e.target.checked })} /> {t('student.visibleToParents')}
            </label>
            <button type="submit" className="btn btn--primary" disabled={addIncident.isPending}>{t('common.save')}</button>
          </form>
        )}
      </section>
    </div>
  );
}
