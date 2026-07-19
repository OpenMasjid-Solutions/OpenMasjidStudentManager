// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 OpenMasjid-Solutions
/** Parent portal — My Family (read-only slice, CLAUDE.md §4/§15). Phone-first: a big balance
 *  card, the family's kids (with their PINs), open invoices, and recent payments. Grades /
 *  schedule / merit / report cards arrive in later slices. Everything is family-scoped server-side. */
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Download, FileText } from 'lucide-react';
import { staggerContainer, staggerItem } from '../../lib/motion';
import { trpc } from '../../lib/trpc';
import { formatMoney } from '../../lib/money';
import { PayNow } from './PayNow';
import { PayMethods } from './PayMethods';

export function FamilyHome({ onOpenChild }: { onOpenChild: (studentId: string, name: string) => void }) {
  const { t } = useTranslation();
  const q = trpc.portal.myFamily.useQuery();
  const reportsQ = trpc.portal.myReports.useQuery();
  const payConfigQ = trpc.portal.payConfig.useQuery();
  const utils = trpc.useUtils();

  if (q.isLoading) return <div className="fam-empty">{t('status.connecting')}</div>;
  // A transient failure must not masquerade as "you have no family" (which tells them to call the office).
  if (q.isError) return <div className="fam-empty">{t('family.loadError')}</div>;
  const data = q.data;
  if (!data || data.families.length === 0) return <div className="fam-empty">{t('family.noFamily')}</div>;
  const money = (c: number) => formatMoney(c, data.currency);
  const fmtDate = (v: unknown) => new Date(v as number).toLocaleDateString();

  return (
    <motion.div variants={staggerContainer} initial="initial" animate="animate" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {data.families.map((fam) => {
        const owed = fam.balance.owedCents > 0;
        const credit = fam.balance.creditCents > 0;
        return (
          <motion.div key={fam.id} variants={staggerItem} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {data.families.length > 1 && <div className="fam-hello"><h1>{fam.name}</h1></div>}

            {/* Balance */}
            <div className="balance-card glass-raised">
              <div className="lbl">{t('family.balance')}</div>
              <div className={`amt ${owed ? 'owed' : 'settled'}`}>
                {owed ? money(fam.balance.owedCents) : credit ? money(fam.balance.creditCents) : money(0)}
              </div>
              <div className="sub">{owed ? t('family.due') : credit ? t('family.inCredit') : t('family.allSettled')}</div>
              {owed && payConfigQ.data?.ready && (
                <PayNow familyId={fam.id} owedCents={fam.balance.owedCents} currency={data.currency} onPaid={() => void utils.portal.myFamily.invalidate()} />
              )}
            </div>

            {/* Kids + PINs */}
            <section className="fam-section">
              <h2>{t('family.children')}</h2>
              {fam.students.length === 0 ? (
                <div className="fam-empty">{t('family.noChildren')}</div>
              ) : (
                fam.students.map((s) => (
                  <button key={s.id} type="button" className="kid-row glass fx-glint" onClick={() => onOpenChild(s.id, `${s.firstName} ${s.lastName}`.trim())} style={{ width: '100%', textAlign: 'start', cursor: 'pointer' }}>
                    <span className="kid-name">{s.firstName} {s.lastName}</span>
                    <span className="kid-pin"><span className="pin-lbl">{t('directory.pin')}</span>{s.pin}</span>
                  </button>
                ))
              )}
            </section>

            {/* Open invoices */}
            <section className="fam-section">
              <h2>{t('family.openInvoices')}</h2>
              {fam.invoices.length === 0 ? (
                <div className="fam-empty">{t('family.noOpenInvoices')}</div>
              ) : (
                fam.invoices.map((i) => (
                  <div key={i.id} className="list-row glass">
                    <div className="row-main">
                      <span className="row-title">{i.label}</span>
                      {i.dueDate && <span className="row-sub">{t('family.due')} {fmtDate(new Date(`${i.dueDate}T12:00:00`).getTime())}</span>}
                    </div>
                    <span className="row-amt neg">{money(i.balanceCents)}</span>
                  </div>
                ))
              )}
            </section>

            {/* Payment history */}
            <section className="fam-section">
              <h2>{t('family.paymentHistory')}</h2>
              {fam.payments.length === 0 ? (
                <div className="fam-empty">{t('family.noPayments')}</div>
              ) : (
                fam.payments.map((p) => (
                  <div key={p.id} className="list-row glass">
                    <div className="row-main">
                      <span className="row-title">{t(`billing.ch_${p.channel}`, p.channel)}</span>
                      <span className="row-sub">{fmtDate(p.occurredAt)}{p.reversalOf ? ` · ${t('family.reversed')}` : ''}</span>
                    </div>
                    <span className={`row-amt ${p.amountCents < 0 ? 'neg' : 'pos'}`}>{money(p.amountCents)}</span>
                  </div>
                ))
              )}
            </section>

            {/* Saved cards + autopay (hidden when card payments aren't configured). */}
            <PayMethods familyId={fam.id} />
          </motion.div>
        );
      })}

      {/* Published report cards & transcripts — the documents families keep (§15). */}
      {reportsQ.data?.children.some((c) => c.reportCards.length || c.transcripts.length) && (
        <motion.section className="fam-section" variants={staggerItem}>
          <h2>{t('family.reportCards')}</h2>
          {reportsQ.data.children.map((c) =>
            c.reportCards.length || c.transcripts.length ? (
              <div key={c.studentId} style={{ marginBlockEnd: '0.7rem' }}>
                <div className="row-sub" style={{ fontWeight: 600, marginBlockEnd: '0.4rem' }}>{c.name}</div>
                {c.reportCards.map((r) => (
                  <a key={r.id} className="list-row glass" href={`/reports/card/${r.id}`} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>
                    <span style={{ display: 'inline-flex', color: 'var(--color-primary)' }}><FileText size={18} /></span>
                    <div className="row-main">
                      <span className="row-title">{r.className}</span>
                      <span className="row-sub">{t('family.reportCard')} · v{r.version}</span>
                    </div>
                    <span className="row-amt" style={{ color: 'var(--color-text-muted)' }}><Download size={16} /></span>
                  </a>
                ))}
                {c.transcripts.map((tr) => (
                  <a key={tr.id} className="list-row glass" href={`/reports/transcript/${tr.id}`} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>
                    <span style={{ display: 'inline-flex', color: 'var(--color-gold)' }}><FileText size={18} /></span>
                    <div className="row-main">
                      <span className="row-title">{t('family.transcript')}</span>
                      <span className="row-sub">v{tr.version}</span>
                    </div>
                    <span className="row-amt" style={{ color: 'var(--color-text-muted)' }}><Download size={16} /></span>
                  </a>
                ))}
              </div>
            ) : null,
          )}
        </motion.section>
      )}
    </motion.div>
  );
}
