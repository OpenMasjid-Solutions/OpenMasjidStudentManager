// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/** One family's billing (admin/finance window): balance, per-student fee assignment + discount,
 *  invoices (with void), a manual-payment form, and the payments ledger (with reverse). Money is
 *  integer cents end-to-end; the server ledger is the source of truth. RTL-safe. */
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Printer } from 'lucide-react';
import { trpc } from '../lib/trpc';
import { formatMoney, parseCents } from '../lib/money';
import { withBase } from '../lib/base';

export function FamilyBilling({ familyId, currency }: { familyId: string; currency: string }) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const billing = trpc.billing.familyBilling.useQuery({ familyId });
  const fees = trpc.billing.familyFees.useQuery({ familyId });
  const plans = trpc.billing.feePlanList.useQuery();
  const assign = trpc.billing.assignFee.useMutation();
  const unassign = trpc.billing.unassignFee.useMutation();
  const setDiscount = trpc.billing.setDiscount.useMutation();
  const generate = trpc.billing.generateFamily.useMutation();
  const voidInv = trpc.billing.voidInvoice.useMutation();
  const pay = trpc.billing.recordManualPayment.useMutation();
  const reverse = trpc.billing.reversePayment.useMutation();

  const [gen, setGen] = useState({ periodKey: '', label: '', dueDate: '' });
  const [payment, setPayment] = useState({ amount: '', channel: 'cash', occurredAt: new Date().toISOString().slice(0, 10), memo: '' });
  const money = (c: number) => formatMoney(c, currency);

  const refresh = async () => { await utils.billing.familyBilling.invalidate({ familyId }); await utils.billing.familyFees.invalidate({ familyId }); };

  async function doGenerate(e: FormEvent) {
    e.preventDefault();
    if (!gen.periodKey.trim() || !gen.label.trim()) return;
    await generate.mutateAsync({ familyId, periodKey: gen.periodKey.trim(), label: gen.label.trim(), dueDate: gen.dueDate || undefined });
    setGen({ periodKey: '', label: '', dueDate: '' });
    await refresh();
  }
  async function doPay(e: FormEvent) {
    e.preventDefault();
    const cents = parseCents(payment.amount);
    if (!cents || cents < 1) return;
    await pay.mutateAsync({ familyId, amountCents: cents, channel: payment.channel as 'cash' | 'zelle' | 'check' | 'other', occurredAt: payment.occurredAt, memo: payment.memo.trim() || undefined });
    setPayment({ ...payment, amount: '', memo: '' });
    await refresh();
  }

  const bal = billing.data?.balance;
  const activePlans = plans.data ?? [];

  return (
    <div className="win-content">
      {/* Balance */}
      <section className="section glass" style={{ padding: '1rem 1.1rem' }}>
        <div className="section-head">
          <h2>{t('billing.balance')}</h2>
          <a className="btn btn--ghost btn--sm" href={withBase(`/statements/family/${familyId}`)} target="_blank" rel="noopener noreferrer"><Printer size={14} /> {t('billing.printStatement')}</a>
        </div>
        {bal && (
          <div className="bal-big" style={{ color: bal.owedCents > 0 ? 'var(--color-danger)' : 'var(--color-success)' }}>
            {bal.owedCents > 0 ? money(bal.owedCents) : bal.creditCents > 0 ? `${money(bal.creditCents)} ${t('billing.credit')}` : money(0)}
          </div>
        )}
      </section>

      {/* Fees + discount */}
      <section className="section glass" style={{ padding: '1rem 1.1rem' }}>
        <div className="section-head"><h2>{t('billing.fees')}</h2></div>
        {(fees.data ?? []).length === 0 ? (
          <p className="muted" style={{ fontSize: '0.9rem' }}>{t('billing.noEnrollments')}</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {fees.data?.map((f) => (
              <div key={f.enrollmentId + (f.feeId ?? '')} className="glass-inset" style={{ padding: '0.5rem 0.7rem', borderRadius: 'var(--radius-button)', display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                <span style={{ flex: '1 1 10rem' }}>{f.firstName} {f.lastName} · <span className="muted">{f.className}</span></span>
                {f.feeId ? (
                  <>
                    <span className="chip">{f.feePlanName} · {money(f.amountCents ?? 0)}</span>
                    <button type="button" className="btn btn--ghost btn--sm" onClick={async () => { await unassign.mutateAsync({ id: f.feeId! }); await refresh(); }}>{t('billing.removeFee')}</button>
                  </>
                ) : (
                  <select className="input glass-inset" style={{ flex: '0 1 12rem' }} defaultValue="" onChange={async (e) => { if (e.target.value) { await assign.mutateAsync({ enrollmentId: f.enrollmentId, feePlanId: e.target.value }); await refresh(); } }}>
                    <option value="">{t('billing.assignFee')}</option>
                    {activePlans.map((p) => <option key={p.id} value={p.id}>{p.name} · {money(p.amountCents)}</option>)}
                  </select>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Invoices + generate */}
      <section className="section glass" style={{ padding: '1rem 1.1rem' }}>
        <div className="section-head"><h2>{t('billing.invoices')}</h2></div>
        {(billing.data?.invoices ?? []).length === 0 ? (
          <p className="muted" style={{ fontSize: '0.9rem' }}>{t('billing.noInvoices')}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead><tr><th>{t('billing.invoice')}</th><th>{t('billing.due')}</th><th>{t('billing.total')}</th><th>{t('billing.paid')}</th><th>{t('billing.status')}</th><th className="actions" /></tr></thead>
              <tbody>
                {billing.data?.invoices.map((i) => (
                  <tr key={i.id}>
                    <td>{i.label}</td>
                    <td>{i.dueDate ?? '—'}</td>
                    <td>{money(i.totalCents)}</td>
                    <td>{money(i.paidCents)}</td>
                    <td><span className={`chip ${i.status === 'paid' ? 'is-accent' : 'is-muted'}`}>{t(`billing.st_${i.status}`)}</span></td>
                    <td className="actions">{i.status !== 'void' && i.paidCents === 0 && <button type="button" className="btn btn--ghost btn--sm" onClick={async () => { await voidInv.mutateAsync({ id: i.id }); await refresh(); }}>{t('billing.void')}</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <form className="inline-form glass-inset" onSubmit={doGenerate}>
          <div className="field"><label className="label">{t('billing.periodKey')}</label><input className="input glass-inset" value={gen.periodKey} onChange={(e) => setGen({ ...gen, periodKey: e.target.value })} placeholder="2026-07" /></div>
          <div className="field"><label className="label">{t('billing.label')}</label><input className="input glass-inset" value={gen.label} onChange={(e) => setGen({ ...gen, label: e.target.value })} placeholder={t('billing.labelHint')} /></div>
          <div className="field" style={{ flex: '0 1 10rem' }}><label className="label">{t('billing.due')}</label><input type="date" className="input glass-inset" value={gen.dueDate} onChange={(e) => setGen({ ...gen, dueDate: e.target.value })} /></div>
          <button type="submit" className="btn btn--primary" disabled={generate.isPending}>{t('billing.generate')}</button>
        </form>
      </section>

      {/* Record payment */}
      <section className="section glass" style={{ padding: '1rem 1.1rem' }}>
        <div className="section-head"><h2>{t('billing.recordPayment')}</h2></div>
        <form className="inline-form glass-inset" onSubmit={doPay} style={{ marginBlockStart: 0 }}>
          <div className="field" style={{ flex: '0 1 8rem' }}><label className="label">{t('billing.amount')}</label><input type="number" step="0.01" min="0" className="input glass-inset" value={payment.amount} onChange={(e) => setPayment({ ...payment, amount: e.target.value })} /></div>
          <div className="field" style={{ flex: '0 1 8rem' }}><label className="label">{t('billing.channel')}</label>
            <select className="input glass-inset" value={payment.channel} onChange={(e) => setPayment({ ...payment, channel: e.target.value })}>
              {['cash', 'zelle', 'check', 'other'].map((c) => <option key={c} value={c}>{t(`billing.ch_${c}`)}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: '0 1 10rem' }}><label className="label">{t('billing.date')}</label><input type="date" className="input glass-inset" value={payment.occurredAt} onChange={(e) => setPayment({ ...payment, occurredAt: e.target.value })} /></div>
          <div className="field"><label className="label">{t('billing.memo')}</label><input className="input glass-inset" value={payment.memo} onChange={(e) => setPayment({ ...payment, memo: e.target.value })} /></div>
          <button type="submit" className="btn btn--primary" disabled={pay.isPending || !parseCents(payment.amount)}>{t('billing.record')}</button>
        </form>

        {(billing.data?.payments ?? []).length > 0 && (
          <div style={{ overflowX: 'auto', marginBlockStart: '0.75rem' }}>
            <table className="data-table">
              <tbody>
                {billing.data?.payments.map((p) => (
                  <tr key={p.id}>
                    <td className={p.amountCents < 0 ? 'merit-total is-neg' : 'merit-total is-pos'}>{money(p.amountCents)}</td>
                    <td>{t(`billing.ch_${p.channel}`, p.channel)}</td>
                    <td>{new Date(p.occurredAt as unknown as number).toISOString().slice(0, 10)}</td>
                    <td className="muted">{p.memo ?? ''}</td>
                    <td className="actions">{p.amountCents > 0 && !p.reversalOf && <button type="button" className="btn btn--ghost btn--sm" onClick={async () => { if (!window.confirm(t('billing.confirmReverse'))) return; await reverse.mutateAsync({ paymentId: p.id }); await refresh(); }}>{t('billing.reverse')}</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Discount */}
      <section className="section glass" style={{ padding: '1rem 1.1rem' }}>
        <div className="section-head"><h2>{t('billing.discount')}</h2></div>
        {billing.data && <DiscountForm key={familyId} familyId={familyId} current={billing.data.discount} onSaved={refresh} setDiscount={setDiscount} />}
      </section>
    </div>
  );
}

function DiscountForm({ familyId, current, onSaved, setDiscount }: { familyId: string; current: { kind: 'none' | 'fixed' | 'percent'; value: number }; onSaved: () => Promise<void>; setDiscount: ReturnType<typeof trpc.billing.setDiscount.useMutation> }) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<'none' | 'fixed' | 'percent'>(current.kind);
  // Stored as basis points (percent) or cents (fixed); show as plain percent / dollars.
  const [value, setValue] = useState(current.kind === 'none' ? '' : current.kind === 'percent' ? String(current.value / 100) : (current.value / 100).toFixed(2));
  async function save(e: FormEvent) {
    e.preventDefault();
    const v = kind === 'none' ? 0 : kind === 'percent' ? Math.round(Number(value) * 100) : parseCents(value) ?? 0;
    await setDiscount.mutateAsync({ familyId, kind, value: v });
    await onSaved();
  }
  return (
    <form className="inline-form glass-inset" onSubmit={save} style={{ marginBlockStart: 0 }}>
      <div className="field" style={{ flex: '0 1 10rem' }}><label className="label">{t('billing.discountKind')}</label>
        <select className="input glass-inset" value={kind} onChange={(e) => setKind(e.target.value as 'none' | 'fixed' | 'percent')}>
          <option value="none">{t('billing.dk_none')}</option>
          <option value="fixed">{t('billing.dk_fixed')}</option>
          <option value="percent">{t('billing.dk_percent')}</option>
        </select>
      </div>
      {kind !== 'none' && <div className="field" style={{ flex: '0 1 8rem' }}><label className="label">{kind === 'percent' ? '%' : t('billing.amount')}</label><input type="number" step="0.01" min="0" className="input glass-inset" value={value} onChange={(e) => setValue(e.target.value)} /></div>}
      <button type="submit" className="btn btn--primary" disabled={setDiscount.isPending}>{t('common.save')}</button>
    </form>
  );
}
