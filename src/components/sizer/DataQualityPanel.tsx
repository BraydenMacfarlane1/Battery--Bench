import { billCheckView, hourlySourceLabel, nemPanelNote, overallConfidence, type ConfidenceLabel } from "../../sun-daddy/confidence";
import type { HourlySourceKind } from "../../sun-daddy/types";
import type { SunStudyView } from "./context";
import { useSizer } from "./context";

export function DataQualityPanel() {
  const sizer = useSizer();
  if (sizer.source !== "sun") {
    return (
      <section className="quality-panel" data-testid="data-quality">
        <h3>Data quality</h3>
        <p className="meta">This study has no Sun Daddy data-quality record.</p>
      </section>
    );
  }
  const view = qualityView(sizer.sunStudy, sizer.tariffWarnings, sizer.loadSourceBadge);
  return (
    <section className="quality-panel" data-testid="data-quality">
      <h3>Data quality</h3>
      <p className={`confidence confidence-${view.confidence.toLowerCase()}`} data-testid="confidence-label">
        Confidence: {view.confidence}
      </p>
      <dl className="summary-grid">
        <div>
          <dt>Hourly source</dt>
          <dd data-testid="hourly-source">{view.hourlyLabel}</dd>
        </div>
        <div>
          <dt>Peaks source</dt>
          <dd>{view.peaksLabel}</dd>
        </div>
        <div>
          <dt>Bill check</dt>
          <dd data-testid="bill-check" className={`bill-check is-${view.billTone}`}>
            {view.billTitle}
            {view.billDetail ? <span className="meta"> {view.billDetail}</span> : null}
          </dd>
        </div>
      </dl>
      {view.savingsWarning ? (
        <div className="state-card is-error" role="alert" data-testid="bill-check-warning">
          <p className="state-title">Savings are less reliable</p>
          <p>{view.savingsWarning}</p>
        </div>
      ) : null}
      <p className="meta" data-testid="rate-verification">
        {view.rateText}{" "}
        {view.rateUrl ? (
          <a href={view.rateUrl} target="_blank" rel="noreferrer">
            Rate source
          </a>
        ) : null}
      </p>
      {view.nemNote ? (
        <p className="note" data-testid="nem-note">
          {view.nemNote}
        </p>
      ) : null}
    </section>
  );
}

export type QualityView = {
  confidence: ConfidenceLabel;
  hourlyLabel: string;
  peaksLabel: string;
  billTitle: string;
  billDetail: string | null;
  billTone: string;
  savingsWarning: string | null;
  rateText: string;
  rateUrl: string | null;
  nemNote: string | null;
};

export function qualityView(
  study: SunStudyView | null,
  tariffWarnings: readonly string[],
  loadBadge: string | null,
): QualityView {
  const profile = study?.profile ?? null;
  const hourlyKind: HourlySourceKind = profile?.hourly_kind ?? kindFromBadge(loadBadge);
  const bill = billCheckView(profile?.bill_check ?? null);
  const verified = Boolean(study?.verification?.last_verified_at);
  const confidence = overallConfidence({ hourlyKind, bill: profile?.bill_check ?? null, rateVerified: verified });
  const verification = study?.verification;
  const rateUrl = safeHttpUrl(verification?.source_url ?? null);
  let rateText = "Rate not verified";
  if (verification?.last_verified_at) {
    const bits = [`Rate verified ${verification.last_verified_at}`];
    if (verification.verified_by) bits.push(`by ${verification.verified_by}`);
    if (verification.effective_date) bits.push(`effective ${verification.effective_date}`);
    rateText = `${bits.join(", ")}.`;
  }
  return {
    confidence,
    hourlyLabel: hourlySourceLabel(hourlyKind, profile?.hourly_source ?? null),
    peaksLabel: profile?.peaks_source ? profile.peaks_source.replace(/[_-]+/g, " ") : "Not named",
    billTitle: bill.title,
    billDetail: bill.detail,
    billTone: bill.tone,
    savingsWarning: bill.savingsWarning,
    rateText,
    rateUrl,
    nemNote: nemPanelNote(tariffWarnings, study?.nem ?? null),
  };
}

function kindFromBadge(badge: string | null): HourlySourceKind {
  if (badge === "Measured hourly data") return "measured";
  if (badge === "Estimated from bills") return "synthesized_from_bills";
  return "unknown";
}

function safeHttpUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol === "https:" || url.protocol === "http:") return url.toString();
  } catch {
    return null;
  }
  return null;
}
