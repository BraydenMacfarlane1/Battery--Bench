import { formatCount } from "./format";
import { useSizer } from "./context";

export function SiteStep() {
  const sizer = useSizer();
  const solarLabel = sizer.annualSolarKwh > 0 ? `${formatCount(sizer.annualSolarKwh)} kWh` : "None";
  return (
    <div className="step">
      <dl className="summary-grid">
        <div>
          <dt>Customer</dt>
          <dd>{sizer.meta.customerName}</dd>
        </div>
        <div>
          <dt>Project</dt>
          <dd>{sizer.meta.projectName}</dd>
        </div>
        <div>
          <dt>Utility</dt>
          <dd data-testid="site-utility">{sizer.meta.utility ?? "Not listed"}</dd>
        </div>
        <div>
          <dt>Rate</dt>
          <dd>{sizer.rateName}</dd>
        </div>
        <div>
          <dt>Annual load</dt>
          <dd>{sizer.hasData ? `${formatCount(sizer.annualLoadKwh)} kWh` : "—"}</dd>
        </div>
        <div>
          <dt>Peak</dt>
          <dd>{sizer.hasData ? `${formatCount(sizer.peakKw, 1)} kW` : "—"}</dd>
        </div>
        <div>
          <dt>Solar</dt>
          <dd>{sizer.hasData ? solarLabel : "—"}</dd>
        </div>
      </dl>

      {sizer.source === "example" ? (
        <p className="note" data-testid="example-note">
          {sizer.rateName} · {sizer.hasData ? "8,760 load hours" : "load incomplete"} ·{" "}
          {sizer.annualSolarKwh > 0 ? "solar attached" : "no solar"}. Round-number example prices are not a utility tariff.
        </p>
      ) : null}

      {sizer.tariffWarnings.length > 0 ? (
        <div className="callout" role="status" data-testid="tariff-callout">
          <p className="state-title">Rate needs a look</p>
          <p>{sizer.tariffWarnings.join(" ")}</p>
        </div>
      ) : null}

      {sizer.checkWarnings.length > 0 ? (
        <details className="fold" data-testid="things-to-check">
          <summary>Things to check</summary>
          <ul>
            {sizer.checkWarnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </details>
      ) : null}

      <details className="fold">
        <summary>Billed monthly peaks</summary>
        <label>
          Billed peaks (kW)
          <input
            value={sizer.billedText}
            onChange={(event) => sizer.setBilledText(event.target.value)}
            placeholder="140, or twelve values for January through December"
          />
        </label>
        <p className="meta">
          One number repeats for every month. Twelve numbers are January through December. Leave this blank to use the
          hourly peak.
        </p>
      </details>

      <details className="fold">
        <summary>Rate override</summary>
        <label className="check">
          <input
            type="checkbox"
            checked={sizer.simpleRate}
            onChange={(event) => sizer.setSimpleRate(event.target.checked)}
          />
          Enter a simple rate instead of the loaded tariff
        </label>
        {sizer.simpleRate ? (
          <div className="form-grid">
            <label>
              Off-peak $/kWh
              <input value={sizer.flatEnergy} onChange={(event) => sizer.setFlatEnergy(event.target.value)} />
            </label>
            <label>
              On-peak $/kWh
              <input value={sizer.peakEnergy} onChange={(event) => sizer.setPeakEnergy(event.target.value)} />
            </label>
            <label>
              Peak start hour
              <input value={sizer.peakStart} onChange={(event) => sizer.setPeakStart(event.target.value)} />
            </label>
            <label>
              Peak end hour
              <input value={sizer.peakEnd} onChange={(event) => sizer.setPeakEnd(event.target.value)} />
            </label>
            <label>
              Facilities $/kW
              <input value={sizer.facilities} onChange={(event) => sizer.setFacilities(event.target.value)} />
            </label>
            <label>
              On-peak demand $/kW
              <input value={sizer.peakDemand} onChange={(event) => sizer.setPeakDemand(event.target.value)} />
            </label>
            <label>
              Fixed $/month
              <input value={sizer.fixedCharge} onChange={(event) => sizer.setFixedCharge(event.target.value)} />
            </label>
            <label>
              Export credit $/kWh
              <input value={sizer.exportCredit} onChange={(event) => sizer.setExportCredit(event.target.value)} />
            </label>
          </div>
        ) : (
          <p className="meta">The loaded rate stays in place until you turn this on.</p>
        )}
      </details>
    </div>
  );
}
