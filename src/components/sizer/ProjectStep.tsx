import { projectCountLabel, formatCount, formatUpdated, friendlyToken } from "./format";
import { useSizer } from "./context";

export function ProjectStep() {
  const sizer = useSizer();
  const openGroup = sizer.groups.find((group) => group.key === sizer.openCustomerKey) ?? null;
  return (
    <div className="step">
      <form
        className="search-form"
        onSubmit={(event) => {
          event.preventDefault();
          sizer.searchProjects();
        }}
      >
        <label htmlFor="sun-search">Search Sun Daddy</label>
        <div className="search-row">
          <input
            id="sun-search"
            value={sizer.query}
            autoFocus
            placeholder="Customer or project name"
            onChange={(event) => sizer.setQuery(event.target.value)}
          />
          <button type="submit" className="btn btn-primary" disabled={sizer.busy}>
            {sizer.busy ? "Searching…" : "Search Sun Daddy"}
          </button>
        </div>
      </form>

      {sizer.busy ? (
        <div className="state-card" role="status" aria-busy="true">
          <p className="state-title">Searching customers</p>
          <p className="meta">Sun Daddy is looking up matching projects.</p>
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
        </div>
      ) : null}

      {!sizer.busy && !sizer.sunError && sizer.sunMessage && sizer.groups.length === 0 ? (
        <div className="state-card" role="status">
          <p className="state-title">No customers</p>
          <p>{sizer.sunMessage}</p>
        </div>
      ) : null}

      {!sizer.busy && !openGroup && sizer.groups.length > 0 ? (
        <ul className="entity-list" aria-label="Customers">
          {sizer.groups.map((group) => (
            <li key={group.key}>
              <button type="button" className="entity" onClick={() => sizer.setOpenCustomerKey(group.key)}>
                <span className="entity-body">
                  <span className="entity-title">{group.name}</span>
                  <span className="entity-meta">{projectCountLabel(group.projects.length)}</span>
                </span>
                <span className="entity-go" aria-hidden="true">
                  View
                </span>
              </button>
            </li>
          ))}
        </ul>
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

      {!sizer.busy && sizer.groups.length === 0 && !sizer.sunMessage ? (
        <p className="meta search-hint">Search lists customers. Open a name to see the projects under it.</p>
      ) : null}

      {sizer.loadedNote ? (
        <p className="chip" role="status">
          {sizer.loadedNote}
        </p>
      ) : null}

      <p className="quiet-links">
        <button type="button" className="link-button" onClick={sizer.loadExample}>
          Use example data
        </button>
        <button type="button" className="link-button" onClick={() => sizer.setManualOpen(!sizer.manualOpen)}>
          Upload CSVs / enter manually
        </button>
      </p>

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
