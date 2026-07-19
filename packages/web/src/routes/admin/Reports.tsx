// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/** Report Creator (admin + finance, §4/§5/§14): pick a code-defined dataset → choose columns →
 *  filter → sort → run. Results render on screen, export to CSV (formula-injection-escaped), and
 *  print. No raw SQL — the server composes over registry-declared columns only. */
import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Download, Printer, Plus, X } from 'lucide-react';
import { fadeRise } from '../../lib/motion';
import { trpc, type RouterOutputs } from '../../lib/trpc';
import { formatMoney } from '../../lib/money';
import { toCsv, downloadCsv } from '../../lib/csv';

type Dataset = RouterOutputs['reportCreator']['datasets'][number];
type Filter = { col: string; op: 'contains' | 'equals'; value: string };

export function Reports() {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const datasetsQ = trpc.reportCreator.datasets.useQuery();
  const [running, setRunning] = useState(false);
  const [datasetKey, setDatasetKey] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [filters, setFilters] = useState<Filter[]>([]);
  const [sort, setSort] = useState<{ col: string; dir: 'asc' | 'desc' } | null>(null);
  const [result, setResult] = useState<RouterOutputs['reportCreator']['run'] | null>(null);

  const ds: Dataset | undefined = useMemo(() => datasetsQ.data?.find((d) => d.key === datasetKey), [datasetsQ.data, datasetKey]);

  function chooseDataset(key: string) {
    setDatasetKey(key);
    const d = datasetsQ.data?.find((x) => x.key === key);
    setPicked(d ? d.columns.map((c) => c.key) : []);
    setFilters([]);
    setSort(null);
    setResult(null);
  }
  const toggleCol = (k: string) => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));

  async function doRun() {
    if (!datasetKey) return;
    setRunning(true);
    try {
      const r = await utils.reportCreator.run.fetch({
        datasetKey,
        columns: picked.length ? picked : undefined,
        filters: filters.filter((f) => f.col && f.value.trim() !== ''),
        sort: sort ?? undefined,
        limit: 2000,
      });
      setResult(r);
    } finally {
      setRunning(false);
    }
  }

  function fmt(col: { key: string; type: string }, v: unknown): string {
    if (v == null) return '';
    if (col.type === 'money') return formatMoney(Number(v), result?.currency ?? 'usd');
    return String(v);
  }

  function exportCsv() {
    if (!result) return;
    const headers = result.columns.map((c) => c.label);
    const rows = result.rows.map((r) => result.columns.map((c) => (c.type === 'money' ? Number(r[c.key] ?? 0) / 100 : r[c.key])));
    downloadCsv(`${datasetKey || 'report'}.csv`, toCsv(headers, rows));
  }

  return (
    <motion.div className="page" variants={fadeRise} initial="initial" animate="animate">
      <div className="admin-header"><h1 className="page-title" style={{ fontSize: '1.5rem' }}>{t('nav.reports')}</h1></div>

      {/* Build */}
      <section className="section glass" style={{ padding: '1rem 1.1rem' }}>
        <div className="inline-form glass-inset" style={{ marginBlockStart: 0 }}>
          <div className="field" style={{ flex: '1 1 14rem' }}>
            <label className="label">{t('reports.dataset')}</label>
            <select className="input glass-inset" value={datasetKey} onChange={(e) => chooseDataset(e.target.value)}>
              <option value="">{t('reports.pickDataset')}</option>
              {datasetsQ.data?.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
            </select>
          </div>
        </div>

        {ds && (
          <>
            <div className="section-head" style={{ marginBlockStart: '0.8rem' }}><h2>{t('reports.columns')}</h2></div>
            <div className="chip-row">
              {ds.columns.map((c) => (
                <label key={c.key} className={`chip ${picked.includes(c.key) ? 'is-accent' : ''}`} style={{ cursor: 'pointer' }}>
                  <input type="checkbox" checked={picked.includes(c.key)} onChange={() => toggleCol(c.key)} style={{ marginInlineEnd: '0.35rem' }} />
                  {c.label}
                </label>
              ))}
            </div>

            <div className="section-head" style={{ marginBlockStart: '0.8rem' }}>
              <h2>{t('reports.filters')}</h2>
              <span className="spacer" style={{ marginInlineStart: 'auto' }} />
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setFilters((f) => [...f, { col: ds.columns[0].key, op: 'contains', value: '' }])}><Plus size={14} /> {t('reports.addFilter')}</button>
            </div>
            {filters.map((f, i) => (
              <div key={i} className="inline-form" style={{ padding: 0, marginBlockEnd: '0.4rem' }}>
                <select className="input glass-inset" style={{ flex: '0 1 10rem' }} value={f.col} onChange={(e) => setFilters((fs) => fs.map((x, j) => (j === i ? { ...x, col: e.target.value } : x)))}>
                  {ds.columns.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
                <select className="input glass-inset" style={{ flex: '0 1 8rem' }} value={f.op} onChange={(e) => setFilters((fs) => fs.map((x, j) => (j === i ? { ...x, op: e.target.value as Filter['op'] } : x)))}>
                  <option value="contains">{t('reports.op_contains')}</option>
                  <option value="equals">{t('reports.op_equals')}</option>
                </select>
                <input className="input glass-inset" style={{ flex: 1 }} value={f.value} onChange={(e) => setFilters((fs) => fs.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} placeholder={t('reports.value')} />
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setFilters((fs) => fs.filter((_, j) => j !== i))} aria-label={t('common.remove')}><X size={14} /></button>
              </div>
            ))}

            <div className="inline-form glass-inset" style={{ marginBlockStart: '0.6rem' }}>
              <div className="field" style={{ flex: '0 1 12rem' }}>
                <label className="label">{t('reports.sortBy')}</label>
                <select className="input glass-inset" value={sort?.col ?? ''} onChange={(e) => setSort(e.target.value ? { col: e.target.value, dir: sort?.dir ?? 'asc' } : null)}>
                  <option value="">—</option>
                  {ds.columns.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </div>
              {sort && (
                <div className="field" style={{ flex: '0 1 8rem' }}>
                  <label className="label">{t('reports.direction')}</label>
                  <select className="input glass-inset" value={sort.dir} onChange={(e) => setSort({ col: sort.col, dir: e.target.value as 'asc' | 'desc' })}>
                    <option value="asc">{t('reports.asc')}</option>
                    <option value="desc">{t('reports.desc')}</option>
                  </select>
                </div>
              )}
              <button type="button" className="btn btn--primary" onClick={doRun} disabled={running} style={{ marginInlineStart: 'auto' }}>{t('reports.run')}</button>
            </div>
          </>
        )}
      </section>

      {/* Results */}
      {result && (
        <section className="section glass" style={{ padding: '1rem 1.1rem' }}>
          <div className="section-head">
            <h2>{t('reports.results', { n: result.rows.length })}</h2>
            <span className="spacer" style={{ marginInlineStart: 'auto' }} />
            <button type="button" className="btn btn--ghost btn--sm" onClick={exportCsv}><Download size={14} /> {t('reports.exportCsv')}</button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => window.print()}><Printer size={14} /> {t('reports.print')}</button>
          </div>
          {result.rows.length === 0 ? (
            <p className="empty">{t('reports.noRows')}</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead><tr>{result.columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
                <tbody>
                  {result.rows.map((r, i) => (
                    <tr key={i}>{result.columns.map((c) => <td key={c.key} className={c.type === 'money' || c.type === 'number' ? 'num' : ''}>{fmt(c, r[c.key])}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </motion.div>
  );
}
