import CatalogSizer from "./components/CatalogSizer";

export default function App() {
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
        </div>
      </header>
      <CatalogSizer />
    </div>
  );
}
