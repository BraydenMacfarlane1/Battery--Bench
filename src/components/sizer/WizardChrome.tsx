import { useEffect, useRef, type KeyboardEvent } from "react";
import { BackupStep } from "./BackupStep";
import { BatteryStep } from "./BatteryStep";
import { ProjectStep } from "./ProjectStep";
import { ResultsStep } from "./ResultsStep";
import { SiteStep } from "./SiteStep";
import { useSizer } from "./context";
import { WIZARD_STEPS, type WizardStepId } from "./wizard";

const COPY: Record<WizardStepId, { title: string; lede: string }> = {
  1: {
    title: "Who is this for?",
    lede: "Search Sun Daddy, open a customer, then choose a project.",
  },
  2: {
    title: "Site and rate",
    lede: "Review what loaded. Change the rate only if you need to.",
  },
  3: {
    title: "Battery and goal",
    lede: "Choose what best means. The catalog is ranked against that goal.",
  },
  4: {
    title: "Backup",
    lede: "Optional. This estimates an outage and does not change the bill.",
  },
  5: {
    title: "Results",
    lede: "The recommendation, the other options, and a report you can download.",
  },
};

export function WizardChrome() {
  const sizer = useSizer();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [sizer.step]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!event.altKey || (event.key !== "ArrowRight" && event.key !== "ArrowLeft")) return;
    const tag = (event.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    event.preventDefault();
    if (event.key === "ArrowRight") sizer.goNext();
    if (event.key === "ArrowLeft") sizer.goBack();
  }

  const copy = COPY[sizer.step];
  return (
    <div className="wrap wizard" onKeyDown={onKeyDown}>
      <nav className="progress" aria-label="Wizard progress">
        <p className="progress-count">
          Step {sizer.step} of {WIZARD_STEPS.length}
        </p>
        <ol>
          {WIZARD_STEPS.map((entry) => {
            const state = entry.id === sizer.step ? "current" : entry.id <= sizer.maxReached ? "done" : "upcoming";
            return (
              <li key={entry.id} className={`progress-step is-${state}`}>
                <button
                  type="button"
                  aria-label={`Step ${entry.id}: ${entry.label}`}
                  aria-current={entry.id === sizer.step ? "step" : undefined}
                  disabled={entry.id > sizer.maxReached}
                  onClick={() => sizer.goTo(entry.id)}
                >
                  <span className="progress-index" aria-hidden="true">
                    {entry.id < sizer.step ? "✓" : entry.id}
                  </span>
                  <span className="progress-label">{entry.label}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <section className="panel wizard-panel" aria-labelledby="wizard-title" data-testid="wizard-step" data-step={sizer.step}>
        <header className="step-head">
          <h2 id="wizard-title" ref={headingRef} tabIndex={-1}>
            {copy.title}
          </h2>
          <p>{copy.lede}</p>
        </header>
        {sizer.step === 1 ? <ProjectStep /> : null}
        {sizer.step === 2 ? <SiteStep /> : null}
        {sizer.step === 3 ? <BatteryStep /> : null}
        {sizer.step === 4 ? <BackupStep /> : null}
        {sizer.step === 5 ? <ResultsStep /> : null}
        <div className="wizard-nav">
          <button type="button" className="btn btn-ghost" onClick={sizer.goBack} disabled={sizer.step === 1}>
            Back
          </button>
          {sizer.step < 5 ? (
            <div className="wizard-nav-right">
              {sizer.step === 4 ? (
                <button type="button" className="btn btn-ghost" onClick={sizer.goNext} disabled={!sizer.canNext}>
                  Skip this step
                </button>
              ) : null}
              <button type="button" className="btn btn-primary" onClick={sizer.goNext} disabled={!sizer.canNext}>
                Next
              </button>
            </div>
          ) : (
            <span className="meta">Alt + left or right moves between steps.</span>
          )}
        </div>
      </section>
      <footer className="footer">
        <p>Battery Bench is a sizing worksheet, not an engineering stamp or a utility interconnection approval.</p>
      </footer>
    </div>
  );
}
