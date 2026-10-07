import { CUSTOMER_SORTS, type CustomerGroup } from "../../sun-daddy/customers";
import { useSizer } from "./context";
import { formatCount, formatUpdated, friendlyToken, projectCountLabel } from "./format";

export function ProjectStep() {
  const sizer = useSizer();
  const openGroup = sizer.groups.find((group) => group.key === sizer.openCustomerKey) ?? null;
  const matched = sizer.groups.filter((group) => matchesCustomer(group, sizer.query));
  const visible =
    openGroup && !matched.some((group) => group.key === openGroup.key)
      ? [openGroup, ...matched]
      : matched;
  const showPicker = sizer.projectsStatus === "ready" && sizer.groups.length > 0 && !sizer.busy;
  return (
    <div className="step">
      {showPicker ? (
        <div className="customer-picker">
          <label className="filter-field" htmlFor="customer-filter">
            Filter customers
            <input
              id="customer-filter"
              value={sizer.query}
              placeholder="Optional"
              onChange={(event) => sizer.setQuery(event.target.value)}
            />
          </label>
          <div className="customer-row">
            <label className="grow" htmlFor="customer-select">
              Customer
              <select
                id="customer-select"
                value={sizer.openCustomerKey ?? ""}
                onChange={(event) => sizer.setOpenCustomerKey(event.target.value || null)}
              >
                <option value="">Choose a customer</option>
                {visible.map((group) => (
                  <option key={group.key} value={group.key}>
                    {group.label ?? group.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="sort-field">
              <span className="sort-caption" id="customer-sort-label">
                Sort
              </span>
              <div className="sort-toggle" role="group" aria-labelledby="customer-sort-label">
                {CUSTOMER_SORTS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={sizer.customerSort === option.id}
                    onClick={() => sizer.setCustomerSort(option.id)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {sizer.query.trim() && matched.length === 0 ? <p className="meta">No customers match that filter.</p> : null}
        </div>
      ) : null}

      {sizer.projectsStatus === "loading" ? (
        <div className="state-card" role="status" aria-busy="true">
          <p className="state-title">Loading customers</p>
          <p className="meta">Sun Daddy is loading projects.</p>
          <div className="skeleton" />
          <div className="skeleton" />
          <div className="skeleton short" />
        </div>
      ) : null}

      {sizer.busy ? (
        <div className="state-card" role="status" aria-busy="true">
          <p className="state-title">Loading project</p>
          <p className="meta">Sun Daddy is opening that project.</p>
          <div className="skeleton" />
          <div className="skeleton" />
          <div className="skeleton short" />
        </div>
      ) : null}

      {!sizer.busy && sizer.sunError && sizer.sunMessage ? (
        <div className="state-card is-error" role="alert">
          <p className="state-title">Sun Daddy is not available</p>
          <p>{sizer.sunMessage}</p>
          <p className="meta">You can keep going with example data or your own hourly files.</p>
          {sizer.projectsStatus === "error" ? (
            <button type="button" className="btn btn-ghost" onClick={sizer.reloadProjects}>
              Retry
            </button>
          ) : null}
        </div>
      ) : null}

      {!sizer.busy && !sizer.sunError && sizer.projectsStatus === "ready" && sizer.groups.length === 0 ? (
        <div className="state-card" role="status">
          <p className="state-title">No customers</p>
          <p>{sizer.sunMessage ?? "No projects yet."}</p>
        </div>
      ) : null}

      {!sizer.busy && openGroup ? (
        <div className="project-drill">
          <button type="button" className="link-button" onClick={() => sizer.setOpenCustomerKey(null)}>
            Back to customers
          </button>
          <h3 className="drill-title">{openGroup.name}</h3>
          <p className="meta">{projectCountLabel(openGroup.projects.length)}</p>
          <ul className="entity-list" aria-label={`${openGroup.name} projects`}>
            {openGroup.projects.map((project) => {
              const bits = [
                friendlyToken(project.project_type),
                friendlyToken(project.status),
                formatUpdated(project.updated_at),
                project.system_size_kw != null ? `${formatCount(project.system_size_kw, 0)} kW` : null,
              ].filter((bit): bit is string => Boolean(bit));
              return (
                <li key={project.id}>
                  <button type="button" className="entity" onClick={() => sizer.openProject(project)} disabled={sizer.busy}>
                    <span className="entity-body">
                      <span className="entity-title">{project.name}</span>
                      {project.label && project.label !== project.name ? (
                        <span className="entity-meta">{project.label}</span>
                      ) : null}
                      {bits.length > 0 ? <span className="entity-meta">{bits.join(" · ")}</span> : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {!sizer.busy && !sizer.sunError && sizer.sunMessage && sizer.groups.length > 0 ? (
        <p className="note">{sizer.sunMessage}</p>
      ) : null}

      {sizer.loadedNote ? (
        <p className="chip" role="status">
          <span>{sizer.loadedNote}</span>
          {sizer.loadSourceBadge ? (
            <span className="source-badge" data-testid="load-source-badge">
              {sizer.loadSourceBadge}
            </span>
          ) : null}
        </p>
      ) : null}

      {sizer.missingLoadMessage ? (
        <div className="callout" role="status" id="missing-hourly-load" data-testid="missing-hourly-load">
          <p>{sizer.missingLoadMessage}</p>
          <LoadAlternatives />
        </div>
      ) : (
        <LoadAlternatives />
      )}

      {sizer.manualOpen ? (
        <fieldset className="presets manual-panel">
          <legend>Hourly kWh</legend>
          <label>
            Load kWh, 8,760 values
            <textarea
              value={sizer.loadText}
              onChange={(event) => sizer.setLoadText(event.target.value)}
              rows={3}
              placeholder="Paste hourly kWh, or upload a CSV"
            />
          </label>
          <div className="inline-actions">
            <button type="button" className="btn btn-ghost" onClick={sizer.readLoadText}>
              Use pasted load
            </button>
            <label className="upload">
              Load CSV
              <input
                type="file"
                accept=".csv,text/csv,text/plain"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void file.text().then(sizer.readLoadFile);
                  event.target.value = "";
                }}
              />
            </label>
          </div>
          <label>
            Solar kWh, 8,760 values
            <textarea value={sizer.solarText} onChange={(event) => sizer.setSolarText(event.target.value)} rows={3} />
          </label>
          <div className="inline-actions">
            <button type="button" className="btn btn-ghost" onClick={sizer.readSolarText}>
              Use pasted solar
            </button>
            <label className="upload">
              Solar CSV
              <input
                type="file"
                accept=".csv,text/csv,text/plain"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void file.text().then(sizer.readSolarFile);
                  event.target.value = "";
                }}
              />
            </label>
          </div>
          {sizer.inputWarnings.length > 0 ? (
            <p className="warn-line" role="alert">
              {sizer.inputWarnings.join(" ")}
            </p>
          ) : null}
        </fieldset>
      ) : null}
    </div>
  );
}

function matchesCustomer(group: CustomerGroup, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  if (group.name.toLocaleLowerCase().includes(needle)) return true;
  if (group.label?.toLocaleLowerCase().includes(needle)) return true;
  return group.projects.some((project) => project.name.toLocaleLowerCase().includes(needle));
}

function LoadAlternatives() {
  const sizer = useSizer();
  return (
    <p className="quiet-links">
      <button type="button" className="link-button" onClick={sizer.loadExample}>
        Use example data
      </button>
      <button type="button" className="link-button" onClick={() => sizer.setManualOpen(!sizer.manualOpen)}>
        Upload CSVs / enter manually
      </button>
    </p>
  );
}
