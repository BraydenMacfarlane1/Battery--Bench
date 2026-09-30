import { describe, expect, it } from "vitest";
import { canAdvanceWizard } from "../src/components/sizer/wizard";

describe("wizard step gating", () => {
  it("cannot leave the project step without an hourly study", () => {
    expect(canAdvanceWizard(1, { hasData: false, modelOk: false })).toBe(false);
    expect(canAdvanceWizard(1, { hasData: false, modelOk: true })).toBe(false);
    expect(canAdvanceWizard(1, { hasData: true, modelOk: false })).toBe(true);
  });

  it("lets a loaded study reach battery settings, then requires a finished ranking", () => {
    expect(canAdvanceWizard(2, { hasData: true, modelOk: false })).toBe(true);
    expect(canAdvanceWizard(3, { hasData: true, modelOk: false })).toBe(false);
    expect(canAdvanceWizard(3, { hasData: true, modelOk: true })).toBe(true);
    expect(canAdvanceWizard(4, { hasData: true, modelOk: true })).toBe(true);
    expect(canAdvanceWizard(4, { hasData: false, modelOk: true })).toBe(false);
    expect(canAdvanceWizard(5, { hasData: true, modelOk: true })).toBe(false);
  });
});
