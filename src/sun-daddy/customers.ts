import type { ProjectListItem } from "./types";

export const NO_CUSTOMER_LABEL = "No customer";

export type CustomerGroup = {
  key: string;
  name: string;
  projects: ProjectListItem[];
};

/** Group a project list by customer name. Blank names share one "No customer" group. */
export function groupProjectsByCustomer(projects: readonly ProjectListItem[]): CustomerGroup[] {
  const groups = new Map<string, CustomerGroup>();
  for (const project of projects) {
    const raw = project.customer_name?.trim() ?? "";
    const name = raw.length > 0 ? raw : NO_CUSTOMER_LABEL;
    const key = name.toLocaleLowerCase();
    const existing = groups.get(key);
    if (existing) existing.projects.push(project);
    else groups.set(key, { key, name, projects: [project] });
  }
  return [...groups.values()]
    .map((group) => ({ ...group, projects: sortProjects(group.projects) }))
    .sort((a, b) => {
      if (a.name === NO_CUSTOMER_LABEL && b.name !== NO_CUSTOMER_LABEL) return 1;
      if (b.name === NO_CUSTOMER_LABEL && a.name !== NO_CUSTOMER_LABEL) return -1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
}

function sortProjects(projects: readonly ProjectListItem[]): ProjectListItem[] {
  return [...projects].sort((a, b) => {
    const at = timestamp(a.updated_at);
    const bt = timestamp(b.updated_at);
    if (at != null && bt != null && at !== bt) return bt - at;
    if (at != null && bt == null) return -1;
    if (at == null && bt != null) return 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

function timestamp(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value.includes("T") ? value : value.replace(" ", "T"));
  return Number.isFinite(parsed) ? parsed : null;
}
