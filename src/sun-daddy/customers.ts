import type { ProjectListItem } from "./types";

export const NO_CUSTOMER_LABEL = "No customer";

export const CUSTOMER_SORTS = [
  { id: "newest", label: "Newest project" },
  { id: "updated", label: "Recently updated" },
  { id: "az", label: "A-Z" },
] as const;

export type CustomerSort = (typeof CUSTOMER_SORTS)[number]["id"];

export type CustomerGroup = {
  key: string;
  name: string;
  projects: ProjectListItem[];
  /** Dropdown text, including the project count and newest date when it parses. */
  label?: string;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

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
    .map((group) => ({ ...group, projects: sortProjectsByUpdated(group.projects) }))
    .sort((a, b) => {
      if (a.name === NO_CUSTOMER_LABEL && b.name !== NO_CUSTOMER_LABEL) return 1;
      if (b.name === NO_CUSTOMER_LABEL && a.name !== NO_CUSTOMER_LABEL) return -1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
}

/**
 * Customers for the project step. Groups by customer_id when the export has one,
 * and by customer name when it does not, so a named customer is still listed.
 * Blank names share one "No customer" group. Projects inside each group use the same sort.
 */
export function groupCustomers(projects: readonly ProjectListItem[], sort: CustomerSort = "newest"): CustomerGroup[] {
  const groups = new Map<string, ProjectListItem[]>();
  for (const project of projects) {
    const key = customerKey(project);
    const existing = groups.get(key);
    if (existing) existing.push(project);
    else groups.set(key, [project]);
  }
  return [...groups.entries()]
    .map(([key, grouped]) => {
      const name = displayName(grouped);
      return {
        key,
        name,
        projects: sortProjects(grouped, sort),
        label: customerOptionLabel(name, grouped),
      };
    })
    .sort((a, b) => compareGroups(a, b, sort));
}

/** "Acquisition.com (2 projects, newest Oct 7)". The date is omitted when it does not parse. */
export function customerOptionLabel(name: string, projects: readonly ProjectListItem[]): string {
  const count = projects.length === 1 ? "1 project" : `${new Intl.NumberFormat("en-US").format(projects.length)} projects`;
  const date = projects.length > 0 ? formatUpdatedDay(newestProject(projects).updated_at) : null;
  return date ? `${name} (${count}, newest ${date})` : `${name} (${count})`;
}

/** Month and day from updated_at, or null when the value is missing or not a real date. */
function formatUpdatedDay(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const iso = trimmed.includes("T") ? trimmed : trimmed.replace(" ", "T");
  if (!Number.isFinite(Date.parse(iso))) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(trimmed);
  if (!match) {
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(iso));
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return `${MONTHS[month - 1]} ${day}`;
}

function customerKey(project: ProjectListItem): string {
  const id = project.customer_id?.trim();
  if (id) return `id:${id}`;
  const name = project.customer_name?.trim() ?? "";
  if (name.length > 0) return `name:${name.toLocaleLowerCase()}`;
  return "none";
}

function displayName(projects: readonly ProjectListItem[]): string {
  const ordered = [...projects].sort(compareProjectIdDesc);
  for (const project of ordered) {
    const name = project.customer_name?.trim();
    if (name) return name;
  }
  return NO_CUSTOMER_LABEL;
}

function sortProjects(projects: readonly ProjectListItem[], sort: CustomerSort): ProjectListItem[] {
  return [...projects].sort((a, b) => compareProjects(a, b, sort));
}

function compareProjects(a: ProjectListItem, b: ProjectListItem, sort: CustomerSort): number {
  if (sort === "az") {
    const byName = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    if (byName !== 0) return byName;
    return compareProjectIdDesc(a, b);
  }
  if (sort === "updated") {
    const byDate = compareUpdatedDesc(a.updated_at, b.updated_at);
    if (byDate !== 0) return byDate;
    return compareProjectIdDesc(a, b);
  }
  return compareProjectIdDesc(a, b);
}

function compareGroups(a: CustomerGroup, b: CustomerGroup, sort: CustomerSort): number {
  if (sort === "az") {
    const byName = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    if (byName !== 0) return byName;
    return compareProjectIdDesc(newestProject(a.projects), newestProject(b.projects));
  }
  if (sort === "updated") {
    const left = mostRecentlyUpdated(a.projects);
    const right = mostRecentlyUpdated(b.projects);
    const byDate = compareUpdatedDesc(left.updated_at, right.updated_at);
    if (byDate !== 0) return byDate;
    return compareProjectIdDesc(left, right);
  }
  return compareProjectIdDesc(newestProject(a.projects), newestProject(b.projects));
}

function newestProject(projects: readonly ProjectListItem[]): ProjectListItem {
  return projects.reduce((best, project) => (compareProjectIdDesc(project, best) < 0 ? project : best));
}

/** Project with the latest updated_at. Equal timestamps keep the higher id. Undated projects lose. */
function mostRecentlyUpdated(projects: readonly ProjectListItem[]): ProjectListItem {
  let best: ProjectListItem | null = null;
  let bestTime: number | null = null;
  for (const project of projects) {
    const time = updatedTimestamp(project.updated_at);
    if (time == null) continue;
    if (best == null || bestTime == null || time > bestTime || (time === bestTime && compareProjectIdDesc(project, best) < 0)) {
      best = project;
      bestTime = time;
    }
  }
  return best ?? newestProject(projects);
}

function compareUpdatedDesc(a: string | undefined, b: string | undefined): number {
  const at = updatedTimestamp(a);
  const bt = updatedTimestamp(b);
  if (at != null && bt != null && at !== bt) return bt - at;
  if (at != null && bt == null) return -1;
  if (at == null && bt != null) return 1;
  return 0;
}

function compareProjectIdDesc(a: ProjectListItem, b: ProjectListItem): number {
  return compareIdDesc(a.id, b.id);
}

function compareIdDesc(a: string, b: string): number {
  const left = idRank(a);
  const right = idRank(b);
  if (left != null && right != null && left !== right) return right - left;
  if (left != null && right == null) return -1;
  if (left == null && right != null) return 1;
  if (a === b) return 0;
  return a < b ? 1 : -1;
}

function idRank(id: string): number | null {
  if (!/^\d+$/.test(id)) return null;
  const value = Number(id);
  return Number.isSafeInteger(value) ? value : null;
}

function updatedTimestamp(value: string | undefined): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Date.parse(trimmed.includes("T") ? trimmed : trimmed.replace(" ", "T"));
  return Number.isFinite(parsed) ? parsed : null;
}

function sortProjectsByUpdated(projects: readonly ProjectListItem[]): ProjectListItem[] {
  return [...projects].sort((a, b) => {
    const at = legacyTimestamp(a.updated_at);
    const bt = legacyTimestamp(b.updated_at);
    if (at != null && bt != null && at !== bt) return bt - at;
    if (at != null && bt == null) return -1;
    if (at == null && bt != null) return 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

function legacyTimestamp(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value.includes("T") ? value : value.replace(" ", "T"));
  return Number.isFinite(parsed) ? parsed : null;
}
