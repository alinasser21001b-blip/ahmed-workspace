import { type ReactNode } from 'react';
import { t, tConfidence, tCurrency, tMsg, tProvenance } from '../i18n.ts';
import { formatMinor } from '../lib/format.ts';

/** The wire shape of an Evidenced<Money> from the server. */
export interface EvidencedWire {
  known: boolean;
  money?: { minor: string; currency: string };
  display?: string;
  currency?: string;
  provenance?: string;
  confidence?: string;
  basis?: string;
  code?: string | null;
  label?: string;
  rate?: { from?: string; to?: string } | null;
  reason?: string;
  missing?: string[];
}

/**
 * Renders a financial figure together with where it came from, or — when the
 * evidence is missing — says so and names exactly what would resolve it.
 *
 * This component is the visible face of the product's central promise. There
 * is no code path here that renders a missing value as zero.
 */
export function Figure({
  label,
  value,
  big,
}: {
  label: string;
  value: EvidencedWire | null | undefined;
  big?: boolean;
}) {
  if (!value || !value.known) {
    return (
      <div className="unknown-box" style={{ marginBottom: 10 }}>
        <div className="title">
          <span aria-hidden="true">◌</span>
          <span>
            {label} — {t('notEnoughEvidence')}
          </span>
        </div>
        {value?.reason || value?.code ? <div>{tMsg(value.code, value.reason)}</div> : null}
        {value?.missing && value.missing.length > 0 ? (
          <div style={{ marginTop: 6 }}>
            <span className="strong">{t('missingEvidence')}: </span>
            {value.missing.map((m) => tMsg(m, m)).join(' · ')}
          </div>
        ) : null}
      </div>
    );
  }
  // A rate renders with both currencies named in the user's language; money
  // renders with its currency name. Bare numbers are not permitted.
  const shown = value.rate
    ? `${value.display ?? '—'} ${tCurrency(value.rate.to ?? '')} / 1 ${tCurrency(value.rate.from ?? '')}`
    : value.money
      ? `${formatMinor(value.money.minor, value.money.currency)} ${tCurrency(value.money.currency)}`
      : value.label ?? value.display ?? '—';
  return (
    <div className="row">
      <div style={{ flex: 1 }}>
        <div className="k">{label}</div>
        <div className="provenance">
          {value.provenance ? tProvenance(value.provenance) : ''}
          {value.confidence ? ` · ${tConfidence(value.confidence)}` : ''}
        </div>
        {value.basis || value.code ? (
          <div className="tiny" style={{ marginTop: 3 }}>{tMsg(value.code, value.basis)}</div>
        ) : null}
      </div>
      <div className={`v num${big ? '' : ''}`} style={big ? { fontSize: '1.25rem' } : undefined}>
        {shown}
      </div>
    </div>
  );
}

export function ConfidenceBadge({ confidence }: { confidence: string }) {
  const tone =
    confidence === 'RECONCILED' || confidence === 'VERIFIED' || confidence === 'HIGH'
      ? 'ok'
      : confidence === 'POSTED' || confidence === 'MEDIUM'
        ? 'info'
        : confidence === 'PENDING' || confidence === 'OBSERVED' || confidence === 'LOW' || confidence === 'LIKELY'
          ? 'warn'
          : 'muted';
  const icon = tone === 'ok' ? '✓' : tone === 'info' ? '•' : tone === 'warn' ? '!' : '?';
  return (
    <span className={`badge ${tone}`}>
      <span aria-hidden="true">{icon}</span>
      {tConfidence(confidence)}
    </span>
  );
}

export function StateBadge({ state, label }: { state: string; label: string }) {
  const tone =
    state === 'RECONCILED' ? 'ok'
    : state === 'POSTED' || state === 'PARTIALLY_RECONCILED' ? 'info'
    : state === 'PENDING' || state === 'CAPTURED' || state === 'PARTIAL_DISPENSE' ? 'warn'
    : state === 'DISCREPANCY' || state === 'FAILED_ATM' || state === 'DISPUTED' ? 'danger'
    : 'muted';
  const icon =
    tone === 'ok' ? '✓' : tone === 'danger' ? '⚠' : tone === 'warn' ? '⏳' : tone === 'info' ? '•' : '—';
  return (
    <span className={`badge ${tone}`}>
      <span aria-hidden="true">{icon}</span>
      {label}
    </span>
  );
}

export function Callout({ tone, children }: { tone: 'warn' | 'danger' | 'info' | 'ok'; children: ReactNode }) {
  const icon = tone === 'ok' ? '✓' : tone === 'danger' ? '⚠' : tone === 'warn' ? '!' : 'ℹ';
  return (
    <div className={`callout ${tone}`}>
      <span aria-hidden="true" style={{ fontWeight: 700, marginInlineEnd: 6 }}>
        {icon}
      </span>
      {children}
    </div>
  );
}

export function AmountField({
  label,
  value,
  onChange,
  currency,
  hint,
  autoFocus,
  inputId,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  currency: string;
  hint?: string;
  autoFocus?: boolean;
  inputId?: string;
}) {
  const id = inputId ?? `amt-${label.replace(/\s/g, '-')}`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="amount-input">
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          dir="ltr"
          value={value}
          autoFocus={autoFocus}
          onChange={(e) => onChange(e.target.value)}
        />
        <span className="cur">{tCurrency(currency)}</span>
      </div>
      {hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

export function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
  columns,
  hint,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
  columns?: 2 | 3;
  hint?: string;
}) {
  return (
    <div className="field">
      <span className="strong" style={{ display: 'block', marginBottom: 6, fontSize: '.9rem' }}>
        {label}
      </span>
      <div className={`choice${columns === 3 ? ' three' : ''}`} role="group" aria-label={label}>
        {options.map((o) => (
          <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
      {hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div
      className="sheet-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sheet">
        <h2>{title}</h2>
        {children}
        <div className="spacer" />
        <button type="button" className="link" onClick={onClose}>
          {t('cancel')}
        </button>
      </div>
    </div>
  );
}

export function Loading() {
  return <div className="center"><div className="muted">{t('loading')}</div></div>;
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="card">
      <Callout tone="danger">{message}</Callout>
      {onRetry ? (
        <>
          <div className="spacer" />
          <button type="button" className="secondary" onClick={onRetry}>
            {t('retry')}
          </button>
        </>
      ) : null}
    </div>
  );
}
