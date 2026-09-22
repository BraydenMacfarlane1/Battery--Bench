/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import App from "../src/App";
import { GROSS_DEMAND_DISCLAIMER } from "../src/sizing/copy";

afterEach(() => cleanup());

describe("sizer UI", () => {
  it("opens on the monthly bill, shows gross demand, and does not preselect non-export", () => {
    render(<App />);
    expect(screen.getByTestId("quality").textContent).toBe("RULE_OF_THUMB");
    expect(screen.getByTestId("gross-demand").textContent).toContain("1,131");
    expect(screen.getByTestId("e-usable").textContent).toContain("Needs a duration preset");
    expect(screen.getByTestId("disclaimer").textContent).toBe(GROSS_DEMAND_DISCLAIMER);
    expect(screen.getByTestId("rate-as-of").textContent).toContain("2026-08-10");
    expect(screen.getByTestId("rate-as-of").textContent).toContain("4.36");
    expect(screen.getByTestId("rate-as-of").textContent).toContain("14.49");
    const exportMode = screen.getByTestId("export-mode") as HTMLSelectElement;
    expect(exportMode.value).toBe("");
    expect(screen.getByText(/will not select it for you/)).toBeTruthy();
  });

  it("loads example A intervals into the locked spike", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Example A spike" }));
    expect(screen.getByTestId("quality").textContent).toBe("RULE_OF_THUMB");
    expect(screen.getByTestId("p-batt").textContent).toContain("60");
    expect(screen.getByTestId("e-usable").textContent).toContain("71.25");
    expect(screen.getByTestId("e-nameplate").textContent).toContain("117.2");
    expect(screen.getByTestId("catalog").textContent).toContain("2 × 60");
    expect(screen.getByTestId("gross-demand").textContent).toContain("1,131");
  });
});
