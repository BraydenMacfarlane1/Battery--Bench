/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("hourly sizer", () => {
  it("ranks the synthetic example without Sun Daddy", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "Battery Bench" })).toBeTruthy();
    expect(screen.getByTestId("example-note").textContent).toContain("Synthetic example rate");
    expect(screen.getByTestId("example-note").textContent).toContain("8,760 load hours");
    expect(screen.getByTestId("active-mode").textContent).toBe("Max annual savings");
    const top = screen.getByTestId("top-pick");
    expect(top.textContent).toMatch(/\d+ × /);
    expect(top.textContent).toContain("/ yr");
    expect(screen.getByTestId("savings-chart")).toBeTruthy();
    const table = screen.getByTestId("comparison-table");
    expect(within(table).getAllByRole("row").length).toBeGreaterThan(3);
    expect(screen.getByTestId("sizer-caveat").textContent).toMatch(/billed|hourly/i);
    expect(screen.getAllByText(/not an engineering stamp/).length).toBeGreaterThan(0);
  });

  it("switches ranking mode without dropping the comparison", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("tab", { name: "Best payback / ROI" }));
    expect(screen.getByTestId("active-mode").textContent).toBe("Best payback / ROI");
    expect(screen.getByTestId("top-pick").textContent).toContain("Best payback / ROI");
    await user.click(screen.getByRole("tab", { name: "Backup duration" }));
    expect(screen.getByTestId("active-mode").textContent).toBe("Backup duration");
    await user.click(screen.getByRole("button", { name: "Schedule 6 worksheet" }));
    await user.click(screen.getByRole("button", { name: "Hourly sizer" }));
    expect(screen.getByTestId("active-mode").textContent).toBe("Backup duration");
  });

  it("rejects a short pasted load and keeps the example ranking", async () => {
    const user = userEvent.setup();
    render(<App />);
    const before = screen.getByTestId("top-pick").textContent;
    await user.type(screen.getByLabelText("Load kWh, 8,760 values"), "1, 2, 3");
    await user.click(screen.getByRole("button", { name: "Use pasted load" }));
    expect(screen.getByRole("alert").textContent).toContain("8,760");
    expect(screen.getByTestId("top-pick").textContent).toBe(before);
  });

  it("shows a clear message when Sun Daddy is not configured", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "Sun Daddy export is not configured. Set the SUN_DADDY_EXPORT_TOKEN secret on the worker." }), {
          status: 503,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Search Sun Daddy" }));
    expect(screen.getByText(/SUN_DADDY_EXPORT_TOKEN/)).toBeTruthy();
    expect(screen.getByTestId("top-pick")).toBeTruthy();
  });

  it("opens a project when the list id is numeric", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/sun-daddy/projects")) {
        return new Response(
          JSON.stringify({
            projects: [{ id: 93, name: "Solar + Battery - Carport", customer_id: 80, pre_rate_id: null }],
            warnings: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/api/sun-daddy/project/93")) {
        return new Response(
          JSON.stringify({
            normalized: {
              schema_version: 1,
              project_id: "93",
              project_name: "Solar + Battery - Carport",
              warnings: [],
              load_kwh: null,
              monthly_kwh: null,
              billed_peak_kw: new Array<number | null>(12).fill(null),
              solar_kwh: null,
              solar_series: [],
              pre_rate: { rate: null, warnings: [] },
              post_rates: [],
              batteries: [],
              economics: {
                discount_rate: 0.06,
                rate_escalator: null,
                federal_tax_rate: null,
                state_tax_rate: null,
                analysis_period: 20,
                system_size_kw: 120,
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Search Sun Daddy" }));
    await user.click(screen.getByRole("button", { name: "Solar + Battery - Carport" }));
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/api/sun-daddy/project/93"))).toBe(true);
    expect(screen.getByText("Loaded Solar + Battery - Carport.")).toBeTruthy();
  });

  it("keeps a chosen battery while the ranking mode changes, then resets to the best", async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByTestId("selection-badge").textContent).toBe("Best for Max annual savings");
    expect(screen.getByTestId("backup-headline").textContent).toMatch(/^About \d+\.\d hours \(conservative \d+\.\d hours\)$/);
    const headline = screen.getByTestId("backup-headline").textContent ?? "";
    const typical = headline.match(/About (\d+\.\d) hours/)?.[1];
    expect(document.querySelector("tr.is-selected")?.textContent).toContain(`${typical} h`);
    expect(screen.getByTestId("monthly-bills").textContent).toContain("Jan");
    expect(screen.getByTestId("dispatch-view").textContent).toMatch(/peak-load day/i);
    expect(screen.getByTestId("backup-column")).toBeTruthy();
    expect((screen.getByLabelText("Percent of building load") as HTMLInputElement).value).toBe("30");
    expect(screen.getByRole("button", { name: "Backup loads" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Percent of load" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(/Hourly resolution only/)).toBeTruthy();
    expect(screen.getByText(/Surge and motor-start loads are ignored/)).toBeTruthy();
    expect(screen.getByText(/islanding-capable/)).toBeTruthy();

    const title = screen.getByTestId("selection-title").textContent ?? "";
    const pick = title.includes("Small cabinet") ? "large" : "small";
    const pickName = pick === "large" ? "Large cabinet" : "Small cabinet";
    await user.selectOptions(screen.getByLabelText("Battery"), pick);
    expect(screen.getByTestId("selection-title").textContent).toContain(pickName);
    expect(screen.getByTestId("selection-compare").textContent).toMatch(/Compared with the best/);
    expect(screen.getByTestId("comparison-table").textContent).toContain("Small cabinet");
    expect(screen.getByTestId("comparison-table").textContent).toContain("Large cabinet");

    await user.click(screen.getByRole("tab", { name: "Best payback / ROI" }));
    expect(screen.getByTestId("active-mode").textContent).toBe("Best payback / ROI");
    expect(screen.getByTestId("selection-title").textContent).toContain(pickName);
    expect(within(screen.getByTestId("comparison-table")).getAllByRole("row").length).toBeGreaterThan(3);

    await user.click(screen.getByRole("button", { name: "Reset to best" }));
    expect(screen.getByTestId("selection-badge").textContent).toBe("Best for Best payback / ROI");
    expect(screen.queryByRole("button", { name: "Reset to best" })).toBeNull();
  });

  it("lets a battery that misses the peak target stay selected", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("tab", { name: "Cheapest peak-kW reduction" }));
    const target = screen.getByLabelText("Peak reduction target (kW)");
    await user.clear(target);
    await user.type(target, "9999");
    const batterySelect = screen.getByLabelText("Battery");
    expect(within(batterySelect).getByRole("option", { name: /Small cabinet/ }).textContent).toMatch(/misses ranking constraint/i);
    await user.selectOptions(batterySelect, "small");
    expect((screen.getByLabelText("Quantity") as HTMLSelectElement).value).toBe("1");
    expect(screen.getByTestId("constraint-note").textContent).toMatch(/Misses the peak target/);
    expect(screen.getByTestId("selection-title").textContent).toContain("Small cabinet");
    expect(screen.getByTestId("monthly-bills")).toBeTruthy();
  });

  it("switches backup to the whole building and still estimates a duration", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Whole building" }));
    expect(screen.getByRole("button", { name: "Whole building" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("backup-headline").textContent).toMatch(/About \d+\.\d hours \(conservative \d+\.\d hours\)/);
    expect(screen.getByTestId("backup-result").textContent).toMatch(/Whole building load/);
    await user.click(screen.getByRole("tab", { name: "Backup duration" }));
    expect(screen.getByTestId("comparison-table").textContent).toMatch(/\d+\.\d h/);
  });

  it("loads the Sun Daddy battery catalog on startup", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/sun-daddy/batteries")) return jsonResponse({ batteries: catalogFixture, warnings: [] });
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);
    expect((await screen.findByTestId("catalog-source")).textContent).toBe("Battery catalog: Sun Daddy (3 batteries)");
    expect(screen.queryByTestId("catalog-placeholder")).toBeNull();
    for (const name of ["Synthetic forty", "Synthetic sixty", "Synthetic block"]) {
      expect(screen.getByLabelText(`${name} name`)).toBeTruthy();
      expect(screen.getByTestId("comparison-table").textContent).toContain(name);
      expect(within(screen.getByLabelText("Battery")).getByRole("option", { name })).toBeTruthy();
    }
    expect(screen.queryByLabelText("Example Small cabinet name")).toBeNull();
    const callsBeforeReload = fetchMock.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "Reload catalog" }));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBeforeReload));
    expect(screen.getByTestId("catalog-source").textContent).toBe("Battery catalog: Sun Daddy (3 batteries)");

    const before = screen.getByTestId("top-pick").textContent;
    const efficiency = screen.getByLabelText("Round-trip efficiency (%)");
    await user.clear(efficiency);
    await user.type(efficiency, "55");
    await waitFor(() => expect(screen.getByTestId("top-pick").textContent).not.toBe(before));
  });

  it("shows placeholder batteries when the catalog cannot be loaded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    render(<App />);
    expect((await screen.findByTestId("catalog-placeholder")).textContent).toMatch(/placeholder batteries/i);
    expect(screen.getByTestId("catalog-placeholder").textContent).toMatch(/not your Sun Daddy catalog/i);
    expect(screen.getByTestId("catalog-source").textContent).toBe("Battery catalog: example placeholders (3 batteries)");
    expect(screen.getByLabelText("Example Small cabinet name")).toBeTruthy();
    expect(screen.getByLabelText("Example Medium cabinet name")).toBeTruthy();
    expect(screen.getByLabelText("Example Large cabinet name")).toBeTruthy();
    expect(screen.getByTestId("comparison-table").textContent).toContain("Example Small cabinet");
  });

  it("falls back to placeholders when the catalog is empty", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ batteries: [], warnings: ["none"] })));
    render(<App />);
    expect((await screen.findByTestId("catalog-placeholder")).textContent).toMatch(/placeholder batteries/i);
    expect(screen.getByLabelText("Example Large cabinet name")).toBeTruthy();
    expect(screen.getByTestId("catalog-source").textContent).toMatch(/example placeholders/);
  });

  it("keeps the full catalog when a project lists one battery", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/sun-daddy/batteries")) return jsonResponse({ batteries: catalogFixture, warnings: [] });
        if (url.includes("/api/sun-daddy/projects")) {
          return jsonResponse({
            projects: [{ id: 93, name: "Synthetic warehouse" }],
            warnings: [],
          });
        }
        if (url.includes("/api/sun-daddy/project/93")) return jsonResponse({ normalized: projectWithOneBattery() });
        throw new Error(`unexpected ${url}`);
      }),
    );
    render(<App />);
    expect((await screen.findByTestId("catalog-source")).textContent).toBe("Battery catalog: Sun Daddy (3 batteries)");
    await user.click(screen.getByRole("button", { name: "Search Sun Daddy" }));
    await user.click(screen.getByRole("button", { name: "Synthetic warehouse" }));
    expect(await screen.findByText("Loaded Synthetic warehouse.")).toBeTruthy();
    expect(screen.getByLabelText("Synthetic forty name")).toBeTruthy();
    expect(screen.getByLabelText("Synthetic sixty name")).toBeTruthy();
    expect(screen.getByLabelText("Synthetic block name")).toBeTruthy();
    expect(screen.getByText("In this project")).toBeTruthy();
    expect(within(screen.getByLabelText("Battery")).getByRole("option", { name: /Synthetic forty — in this project/ })).toBeTruthy();
    expect(within(screen.getByLabelText("Battery")).getByRole("option", { name: "Synthetic sixty" })).toBeTruthy();
    expect(within(screen.getByLabelText("Battery")).getByRole("option", { name: "Synthetic block" })).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByTestId("selection-title").textContent).toBe("2 × Synthetic forty");
    });
    expect(screen.getByTestId("catalog-source").textContent).toBe("Battery catalog: Sun Daddy (3 batteries)");
  });

  it("opens the Schedule 6 worksheet from the tool tab", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Schedule 6 worksheet" }));
    expect(screen.getByTestId("quality").textContent).toBe("RULE_OF_THUMB");
    expect(screen.getByTestId("gross-demand").textContent).toContain("1,131");
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Export-shaped catalog rows. Ids are numbers, the way the live export sends them. */
const catalogFixture = [
  {
    id: 101,
    name: "Synthetic forty",
    manufacturer: "Synthetic",
    model: "S40",
    usable_capacity_kwh: 40,
    max_charge_rate_kw: 20,
    max_discharge_rate_kw: 20,
    cost_per_unit: 22000,
    cost_per_additional_unit: 18000,
    round_trip_efficiency: 0.9,
  },
  {
    id: 102,
    name: "Synthetic sixty",
    manufacturer: "Synthetic",
    model: "S60",
    usable_capacity_kwh: 60,
    max_charge_rate_kw: 30,
    max_discharge_rate_kw: 30,
    cost_per_unit: 30000,
    round_trip_efficiency: 0.9,
  },
  {
    id: 103,
    name: "Synthetic block",
    manufacturer: "Synthetic",
    model: "BLK",
    usable_capacity_kwh: 3854,
    max_charge_rate_kw: 1927,
    max_discharge_rate_kw: 1927,
    cost_per_unit: 800000,
    round_trip_efficiency: 0.9,
  },
];

function projectWithOneBattery() {
  return {
    schema_version: 1,
    project_id: "93",
    project_name: "Synthetic warehouse",
    warnings: [],
    load_kwh: null,
    monthly_kwh: null,
    billed_peak_kw: new Array<number | null>(12).fill(null),
    solar_kwh: null,
    solar_series: [],
    pre_rate: { rate: null, warnings: [] },
    post_rates: [],
    batteries: [
      {
        id: "101",
        name: "Synthetic forty",
        usable_capacity_kwh: 40,
        max_charge_rate_kw: 20,
        max_discharge_rate_kw: 20,
        cost_per_unit: 22000,
        round_trip_efficiency: 0.9,
      },
    ],
    selected_batteries: [{ battery_id: 101, quantity: 2 }],
    economics: {
      discount_rate: 0.06,
      rate_escalator: null,
      federal_tax_rate: null,
      state_tax_rate: null,
      analysis_period: 20,
      system_size_kw: 120,
    },
  };
}
