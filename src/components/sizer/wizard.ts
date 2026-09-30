export const WIZARD_STEPS = [
  { id: 1, label: "Project" },
  { id: 2, label: "Site & rate" },
  { id: 3, label: "Battery" },
  { id: 4, label: "Backup" },
  { id: 5, label: "Results" },
] as const;

export type WizardStepId = (typeof WIZARD_STEPS)[number]["id"];

export function isWizardStep(step: number): step is WizardStepId {
  return WIZARD_STEPS.some((entry) => entry.id === step);
}

/**
 * Step 1 needs a full hourly load. Battery and backup also need a finished ranking,
 * so a broken assumption can be fixed on that step before the report.
 * Backup can be skipped; that still counts as advancing.
 */
export function canAdvanceWizard(step: number, input: { hasData: boolean; modelOk: boolean }): boolean {
  if (!isWizardStep(step) || step >= 5) return false;
  if (!input.hasData) return false;
  if (step >= 3 && !input.modelOk) return false;
  return true;
}
