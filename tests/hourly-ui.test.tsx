/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from "@testing-library/react";
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
    expect(screen.getByText(/not an engineering stamp/)).toBeTruthy();
  });

  it("switches ranking mode without dropping the comparison", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("tab", { name: "Best payback / ROI" }));
    expect(screen.getByTestId("active-mode").textContent).toBe("Best payback / ROI");
    expect(screen.getByTestId("top-pick").textContent).toContain("Best payback / ROI");
    await user.click(screen.getByRole("tab", { name: "Backup duration" }));
    expect(screen.getByTestId("active-mode").textContent).toBe("Backup duration");
  });

  it("rejects a short pasted load and keeps the example ranking", async () => {
    const user = userEvent.setup();
    render(<App />);
    const before = screen.getByTestId("top-pick").textContent;
    await user.type(screen.getByLabelText("Load kWh, 8,760 values"), "1, 2, 3");
    await user.click(screen.getByRole("button", { name: "Use pasted load" }));
    expect(screen.getByTestId("sizer-caveat").textContent).toContain("8,760");
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

  it("opens the Schedule 6 worksheet from the tool tab", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Schedule 6 worksheet" }));
    expect(screen.getByTestId("quality").textContent).toBe("RULE_OF_THUMB");
    expect(screen.getByTestId("gross-demand").textContent).toContain("1,131");
  });
});
