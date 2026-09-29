import { useState } from "react";
import CatalogSizer from "./components/CatalogSizer";
import Worksheet from "./components/Worksheet";

export default function App() {
  const [tab, setTab] = useState<"hourly" | "worksheet">("hourly");
  return (
    <>
      <nav className="app-tabs" aria-label="Tools">
        <button type="button" aria-pressed={tab === "hourly"} onClick={() => setTab("hourly")}>
          Hourly sizer
        </button>
        <button type="button" aria-pressed={tab === "worksheet"} onClick={() => setTab("worksheet")}>
          Schedule 6 worksheet
        </button>
      </nav>
      <div style={{ display: tab === "hourly" ? "block" : "none" }}>
        <CatalogSizer />
      </div>
      <div style={{ display: tab === "worksheet" ? "block" : "none" }}>
        <Worksheet />
      </div>
    </>
  );
}
