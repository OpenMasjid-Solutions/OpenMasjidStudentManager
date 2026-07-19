// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/**
 * Report Creator dataset registry (CLAUDE.md §4, §14, §16) — the ONLY place datasets are defined.
 *
 * HARD RULE: no user-supplied SQL or expressions, ever. Each dataset runs a FIXED Drizzle query
 * (all its columns) and returns plain records; the user's picks (which columns, filters, sort) are
 * applied IN MEMORY over those records against the dataset's code-declared columns and a fixed set
 * of operators. Column keys and operators are validated against the registry on every run, and each
 * dataset declares the minimum role that may see it (re-checked by the runner). A saved report is
 * therefore just data (JSON of picks), never code. Datasets are modest per single-masjid install, so
 * loading a dataset to filter in memory is fine and Pi-friendly.
 */
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { students, families, invoices, payments, admissions } from '../db/schema';
import { invoiceTotal, invoicePaid } from '../billing/ledger';
import { formatMoney } from '../db/money';
import { getCurrency } from '../settings';

export type ColType = 'text' | 'number' | 'date' | 'money';
export type DatasetRole = 'admin' | 'finance';
export interface DatasetColumn {
  key: string;
  label: string;
  type: ColType;
}
export interface Dataset {
  key: string;
  label: string;
  minRole: DatasetRole; // the LOWEST role that may see it: 'finance' → finance+admin; 'admin' → admin only
  columns: DatasetColumn[];
  /** A fixed query returning one record per row, keyed by column key. NEVER shaped by user input. */
  rows: () => Record<string, unknown>[];
}

/** admin sees everything; finance sees only datasets whose minRole is 'finance'. */
export function roleCanSee(role: string, minRole: DatasetRole): boolean {
  if (role === 'admin') return true;
  if (role === 'finance') return minRole === 'finance';
  return false;
}

const famName = (): Map<string, string> => new Map(db.select({ id: families.id, name: families.name }).from(families).all().map((f) => [f.id, f.name]));

export const DATASETS: Dataset[] = [
  {
    key: 'directory',
    label: 'Student directory',
    minRole: 'finance',
    columns: [
      { key: 'firstName', label: 'First name', type: 'text' },
      { key: 'lastName', label: 'Last name', type: 'text' },
      { key: 'family', label: 'Family', type: 'text' },
      { key: 'status', label: 'Status', type: 'text' },
    ],
    rows: () =>
      db.select({ firstName: students.firstName, lastName: students.lastName, familyId: students.familyId, status: students.status }).from(students).all().map((s) => {
        const fam = db.select({ name: families.name }).from(families).where(eq(families.id, s.familyId)).get();
        return { firstName: s.firstName, lastName: s.lastName, family: fam?.name ?? '', status: s.status };
      }),
  },
  {
    key: 'invoices',
    label: 'Invoices',
    minRole: 'finance',
    columns: [
      { key: 'family', label: 'Family', type: 'text' },
      { key: 'label', label: 'Invoice', type: 'text' },
      { key: 'periodKey', label: 'Period', type: 'text' },
      { key: 'dueDate', label: 'Due', type: 'date' },
      { key: 'status', label: 'Status', type: 'text' },
      { key: 'total', label: 'Total', type: 'money' },
      { key: 'paid', label: 'Paid', type: 'money' },
      { key: 'balance', label: 'Balance', type: 'money' },
    ],
    rows: () => {
      const names = famName();
      return db.select().from(invoices).all().map((i) => {
        const total = invoiceTotal(db, i.id);
        const paid = invoicePaid(db, i.id);
        return { family: names.get(i.familyId) ?? '', label: i.label, periodKey: i.periodKey, dueDate: i.dueDate ?? '', status: i.status, total, paid, balance: total - paid };
      });
    },
  },
  {
    key: 'payments',
    label: 'Payments',
    minRole: 'finance',
    columns: [
      { key: 'family', label: 'Family', type: 'text' },
      { key: 'amount', label: 'Amount', type: 'money' },
      { key: 'channel', label: 'Method', type: 'text' },
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'memo', label: 'Memo', type: 'text' },
    ],
    rows: () => {
      const names = famName();
      return db.select().from(payments).all().map((p) => ({
        family: names.get(p.familyId) ?? '', amount: p.amountCents, channel: p.channel, date: p.occurredAt instanceof Date ? p.occurredAt.toISOString().slice(0, 10) : '', memo: p.memo ?? '',
      }));
    },
  },
  {
    key: 'admissions',
    label: 'Admissions',
    minRole: 'admin',
    columns: [
      { key: 'child', label: 'Child', type: 'text' },
      { key: 'guardian', label: 'Guardian', type: 'text' },
      { key: 'program', label: 'Program', type: 'text' },
      { key: 'status', label: 'Status', type: 'text' },
      { key: 'source', label: 'Source', type: 'text' },
      { key: 'date', label: 'Received', type: 'date' },
    ],
    rows: () =>
      db.select().from(admissions).all().map((a) => ({
        child: `${a.childFirstName} ${a.childLastName}`.trim(), guardian: a.guardianName, program: a.programInterest ?? '', status: a.status, source: a.source,
        date: a.createdAt instanceof Date ? a.createdAt.toISOString().slice(0, 10) : '',
      })),
  },
];

export function datasetByKey(key: string): Dataset | undefined {
  return DATASETS.find((d) => d.key === key);
}

// ── The runner (applies picks in memory; validates everything against the registry) ──────────────

export type FilterOp = 'contains' | 'equals';
export interface ReportFilter {
  col: string;
  op: FilterOp;
  value: string;
}
export interface RunInput {
  datasetKey: string;
  columns?: string[];
  filters?: ReportFilter[];
  sort?: { col: string; dir: 'asc' | 'desc' };
  limit?: number;
}

function cmp(a: unknown, b: unknown, type: ColType): number {
  if (type === 'number' || type === 'money') return Number(a ?? 0) - Number(b ?? 0);
  return String(a ?? '').localeCompare(String(b ?? ''));
}

export interface RunResult {
  columns: DatasetColumn[];
  rows: Record<string, unknown>[];
}

/** Execute a saved/ad-hoc report for `role`. Throws if the dataset is unknown or the role can't see
 *  it. Only registry-declared columns are ever selected/filtered/sorted; filter values are compared
 *  in JS (never interpolated into SQL). */
export function runReport(role: string, input: RunInput): RunResult {
  const ds = datasetByKey(input.datasetKey);
  if (!ds) throw new Error('dataset_not_found');
  if (!roleCanSee(role, ds.minRole)) throw new Error('dataset_forbidden');

  const colByKey = new Map(ds.columns.map((c) => [c.key, c]));
  const picked = (input.columns?.length ? input.columns : ds.columns.map((c) => c.key)).filter((k) => colByKey.has(k));
  const cols = picked.length ? picked : ds.columns.map((c) => c.key);

  const currency = getCurrency();
  let rows = ds.rows();
  for (const f of input.filters ?? []) {
    const col = colByKey.get(f.col);
    if (!col) continue; // unknown column → ignored (never a SQL surface)
    const raw = String(f.value ?? '').trim();
    const needle = raw.toLowerCase();
    rows = rows.filter((r) => {
      const cell = r[f.col];
      // Compare against what the user SEES, not the raw storage. Money is stored in cents but shown
      // as dollars; text/date store exactly what's displayed.
      if (col.type === 'money') {
        if (f.op === 'equals') {
          const asCents = Math.round(parseFloat(raw.replace(/[$,\s]/g, '')) * 100);
          return !Number.isNaN(asCents) && Number(cell ?? 0) === asCents;
        }
        return formatMoney(Number(cell ?? 0), currency).toLowerCase().includes(needle);
      }
      if (col.type === 'number') {
        if (f.op === 'equals') {
          const n = parseFloat(raw);
          return !Number.isNaN(n) && Number(cell ?? 0) === n;
        }
        return String(cell ?? '').toLowerCase().includes(needle);
      }
      const c = String(cell ?? '').toLowerCase();
      return f.op === 'equals' ? c === needle : c.includes(needle);
    });
  }
  if (input.sort && colByKey.has(input.sort.col)) {
    const { col, dir } = input.sort;
    const type = colByKey.get(col)!.type;
    rows.sort((a, b) => cmp(a[col], b[col], type));
    if (dir === 'desc') rows.reverse();
  }
  const limit = Math.min(Math.max(input.limit ?? 1000, 1), 5000);
  rows = rows.slice(0, limit);

  const outRows = rows.map((r) => {
    const o: Record<string, unknown> = {};
    for (const k of cols) o[k] = r[k];
    return o;
  });
  return { columns: ds.columns.filter((c) => cols.includes(c.key)), rows: outRows };
}
