import { useState } from "react";
import CatalogSizer from "./components/CatalogSizer";
import Worksheet from "./components/Worksheet";

type Surface = "wizard" | "worksheet" | "interconnect";

export default function App() {
  const [surface, setSurface] = useState<Surface>("wizard");
  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              <svg viewBox="0 0 32 32">
                <rect x="6" y="8" width="20" height="18" rx="3" fill="none" stroke="currentColor" strokeWidth="2" />
                <path d="M11 18h10M11 14h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </span>
            <div>
              <h1>Battery Bench</h1>
              <p className="brand-tag">Commercial battery sizing</p>
            </div>
          </div>
          <nav className="app-tabs" aria-label="Tools">
            <button type="button" aria-pressed={surface === "wizard"} onClick={() => setSurface("wizard")}>
              Hourly sizer
            </button>
            <button type="button" className="tab-quiet" aria-pressed={surface === "worksheet"} onClick={() => setSurface("worksheet")}>
              Schedule 6 worksheet
            </button>
            <button
              type="button"
              className="tab-quiet"
              aria-pressed={surface === "interconnect"}
              onClick={() => setSurface("interconnect")}
            >
              Interconnection
            </button>
          </nav>
        </div>
      </header>
      <div hidden={surface === "worksheet"}>
        <CatalogSizer surface={surface === "interconnect" ? "interconnect" : "wizard"} />
      </div>
      <div hidden={surface !== "worksheet"}>
        <Worksheet />
      </div>
    </div>
  );
}
