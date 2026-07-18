// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/** Billing (admin + finance): fee-plan definitions, a period invoice-generation action, and a
 *  families-with-balances overview that opens each family's billing as a window. */
import { useState, type FormEvent } from 'react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Wallet } from 'lucide-react';
import { fadeRise, staggerContainer, staggerItem } from '../../lib/motion';
import { trpc } from '../../lib/trpc';
import { useWindows } from '../../components/Windows';
import { FamilyBilling } from '../../components/FamilyBilling';
import { formatMoney, parseCents } from '../../lib/money';

export function Billing() {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const { open } = useWindows();
  const currencyQ = trpc.billing.currency.useQuery();
  const currency = currencyQ.data?.currency ?? 'usd';
  const plans = trpc.billing.feePlanList.useQuery();
  const overview = trpc.billing.familiesOverview.useQuery();
  const planCreate = trpc.billing.feePlanCreate.useMutation();
  const planArchive = trpc.billing.feePlanArchive.useMutation();
  const genPeriod = trpc.billing.generatePeriod.useMutation();

  const [plan, setPlan] = useState({ name: '', amount: '', cadence: 'monthly' });
  const [gen, setGen] = useState({ periodKey: '', label: '', dueDate: '' });
  const [genMsg, setGenMsg] = useState<string | null>(null);
  const money = (c: number) => formatMoney(c, currency);

  async function addPlan(e: FormEvent) {
    e.preventDefault();
    const cents = parseCents(plan.amount);
    if (!plan.name.trim() || !cents || cents < 1) return;
    await planCreate.mutateAsync({ name: plan.name.trim(), amountCents: cents, cadence: plan.cadence as 'monthly' | 'per_term' | 'one_time' });
    setPlan({ name: '', amount: '', cadence: 'monthly' });
    await utils.billing.feePlanList.invalidate();
  }
  async function runGenerate(e: FormEvent) {
    e.preventDefault();
    if (!gen.periodKey.trim() || !gen.label.trim()) return;
    const r = await genPeriod.mutateAsync({ periodKey: gen.periodKey.trim(), label: gen.label.trim(), dueDate: gen.dueDate || undefined });
    setGenMsg(t('billing.generatedN', { n: r.created }));
    setGen({ periodKey: '', label: '', dueDate: '' });
    await utils.billing.familiesOverview.invalidate();
  }
  function openFamily(id: string, name: string) {
    open({ title: name, wide: true, dedupeKey: `billing:${id}`, icon: <Wallet size={15} />, node: <FamilyBilling familyId={id} currency={currency} /> });
  }

  return (
    <motion.div className="page" variants={fadeRise} initial="initial" animate="animate">
      <div className="admin-header"><h1 className="page-title" style={{ fontSize: '1.5rem' }}>{t('nav.billing')}</h1></div>

      {/* Fee plans */}
      <section className="section glass" style={{ padding: '1rem 1.1rem' }}>
        <div className="section-head"><h2>{t('billing.feePlans')}</h2></div>
        {(plans.data ?? []).length === 0 ? (
          <p className="muted" style={{ fontSize: '0.9rem' }}>{t('billing.noPlans')}</p>
        ) : (
          <div className="chip-row">
            {plans.data?.map((p) => (
              <span key={p.id} className="chip">{p.name} · {money(p.amountCents)} · {t(`billing.cad_${p.cadence}`)}
                <button type="button" className="link-btn" style={{ marginInlineStart: '0.4rem' }} onClick={async () => { await planArchive.mutateAsync({ id: p.id }); await utils.billing.feePlanList.invalidate(); }}>×</button>
              </span>
            ))}
          </div>
        )}
        <form className="inline-form glass-inset" onSubmit={addPlan}>
          <div className="field"><label className="label">{t('billing.planName')}</label><input className="input glass-inset" value={plan.name} onChange={(e) => setPlan({ ...plan, name: e.target.value })} /></div>
          <div className="field" style={{ flex: '0 1 7rem' }}><label className="label">{t('billing.amount')}</label><input type="number" step="0.01" min="0" className="input glass-inset" value={plan.amount} onChange={(e) => setPlan({ ...plan, amount: e.target.value })} /></div>
          <div className="field" style={{ flex: '0 1 9rem' }}><label className="label">{t('billing.cadence')}</label>
            <select className="input glass-inset" value={plan.cadence} onChange={(e) => setPlan({ ...plan, cadence: e.target.value })}>
              {['monthly', 'per_term', 'one_time'].map((c) => <option key={c} value={c}>{t(`billing.cad_${c}`)}</option>)}
            </select>
          </div>
          <button type="submit" className="btn btn--primary" disabled={planCreate.isPending}>{t('billing.addPlan')}</button>
        </form>
      </section>

      {/* Generate invoices for a period */}
      <section className="section glass" style={{ padding: '1rem 1.1rem' }}>
        <div className="section-head"><h2>{t('billing.generateInvoices')}</h2></div>
        <p className="muted" style={{ fontSize: '0.88rem', marginBlockEnd: '0.6rem' }}>{t('billing.generateHint')}</p>
        {genMsg && <div className="notice notice--warn" style={{ marginBlockEnd: '0.6rem' }}>{genMsg}</div>}
        <form className="inline-form glass-inset" onSubmit={runGenerate} style={{ marginBlockStart: 0 }}>
          <div className="field"><label className="label">{t('billing.periodKey')}</label><input className="input glass-inset" value={gen.periodKey} onChange={(e) => setGen({ ...gen, periodKey: e.target.value })} placeholder="2026-07" /></div>
          <div className="field"><label className="label">{t('billing.label')}</label><input className="input glass-inset" value={gen.label} onChange={(e) => setGen({ ...gen, label: e.target.value })} placeholder={t('billing.labelHint')} /></div>
          <div className="field" style={{ flex: '0 1 10rem' }}><label className="label">{t('billing.due')}</label><input type="date" className="input glass-inset" value={gen.dueDate} onChange={(e) => setGen({ ...gen, dueDate: e.target.value })} /></div>
          <button type="submit" className="btn btn--primary" disabled={genPeriod.isPending}>{t('billing.generateAll')}</button>
        </form>
      </section>

      {/* Families with balances */}
      <section className="section glass" style={{ padding: '1rem 1.1rem' }}>
        <div className="section-head"><h2>{t('billing.families')}</h2></div>
        {(overview.data ?? []).length === 0 ? (
          <p className="empty">{t('billing.noFamilies')}</p>
        ) : (
          <motion.div className="card-grid" variants={staggerContainer} initial="initial" animate="animate">
            {overview.data?.map((f) => (
              <motion.button key={f.id} type="button" className="fam-card glass fx-glint" variants={staggerItem} onClick={() => openFamily(f.id, f.name)}>
                <h3>{f.name}</h3>
                <div className={f.balance.owedCents > 0 ? 'merit-total is-neg' : 'merit-total is-pos'} style={{ fontSize: '1.1rem' }}>
                  {f.balance.owedCents > 0 ? money(f.balance.owedCents) : f.balance.creditCents > 0 ? `${money(f.balance.creditCents)} ${t('billing.credit')}` : money(0)}
                </div>
              </motion.button>
            ))}
          </motion.div>
        )}
      </section>
    </motion.div>
  );
}
