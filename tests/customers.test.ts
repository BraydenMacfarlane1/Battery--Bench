import { describe, expect, it } from "vitest";
import {
  NO_CUSTOMER_LABEL,
  customerOptionLabel,
  groupCustomers,
  groupProjectsByCustomer,
} from "../src/sun-daddy/customers";
import type { ProjectListItem } from "../src/sun-daddy/types";
import { normalizeProjectList } from "../src/sun-daddy/normalize";

describe("customer grouping", () => {
  it("groups by customer name and puts a missing name under No customer", () => {
    const listed = normalizeProjectList([
      {
        id: "p1",
        name: "Warehouse",
        customer_id: "c9",
        customer_name: "Northwind",
        label: "Main",
        project_type: "solar_battery",
        status: "active",
        site_address: "1 Example Plaza",
        utility: "Example Electric",
        updated_at: "2026-01-15",
        system_size_kw: "180.5",
      },
      { id: 2, name: "Older site", customer_name: "Northwind", updated_at: "2026-06-01" },
      { id: 3, name: "Orphan", customer_id: 4 },
      { id: "5", name: "Also missing", customer_name: "   " },
    ]);
    expect(listed.warnings).toEqual([]);
    expect(listed.projects[0]).toMatchObject({
      id: "p1",
      customer_id: "c9",
      customer_name: "Northwind",
      system_size_kw: 180.5,
      site_address: "1 Example Plaza",
    });
    expect(listed.projects[2]).toEqual({ id: "3", name: "Orphan", customer_id: "4" });
    expect(listed.projects[3]).toEqual({ id: "5", name: "Also missing" });

    const groups = groupProjectsByCustomer(listed.projects);
    expect(groups.map((group) => group.name)).toEqual(["Northwind", NO_CUSTOMER_LABEL]);
    expect(groups[0].projects.map((project) => project.name)).toEqual(["Older site", "Warehouse"]);
    expect(groups[1].projects.map((project) => project.name)).toEqual(["Also missing", "Orphan"]);
    expect(groups[0].key).toBe("northwind");
    expect(groups[1].name).toBe("No customer");
  });
});

const pickerProjects: ProjectListItem[] = [
  { id: "10", name: "Roof", customer_id: "1", customer_name: "Acme", updated_at: "2026-01-01 00:00:00" },
  { id: "30", name: "Carport", customer_id: "1", customer_name: "Acme", updated_at: "2026-10-07 15:00:00" },
  { id: "18", name: "yard", customer_id: "2", customer_name: "acme", updated_at: "2026-10-07 15:00:00" },
  { id: "20", name: "Yard", customer_id: "2", customer_name: "acme", updated_at: "2026-10-07 15:00:00" },
  { id: "25", name: "Alpha", customer_id: "2", customer_name: "acme", updated_at: "2026-10-07 15:00:00" },
  { id: "100", name: "Plant", customer_id: "3", customer_name: "Zeta", updated_at: "2026-01-01 00:00:00" },
  { id: "5", name: "Annex", customer_id: "3", customer_name: "Zeta", updated_at: "2026-02-01 00:00:00" },
  { id: "200", name: "Warehouse", customer_id: "4", customer_name: "Bea", updated_at: "2026-01-01 00:00:00" },
  { id: "12", name: "Office", customer_id: "4", customer_name: "Bea", updated_at: "2026-10-07 15:00:00" },
  { id: "4", name: "Orphan" },
];

describe("customer dropdown", () => {
  it("groups by customer id and keeps the same name on two ids apart", () => {
    const groups = groupCustomers(pickerProjects);
    expect(groups.map((group) => [group.key, group.name])).toEqual([
      ["id:4", "Bea"],
      ["id:3", "Zeta"],
      ["id:1", "Acme"],
      ["id:2", "acme"],
      ["none", NO_CUSTOMER_LABEL],
    ]);
    expect(groupCustomers([
      { id: "2", name: "One", customer_name: "Northwind" },
      { id: "4", name: "Two", customer_name: "Northwind" },
      { id: "3", name: "Other", customer_id: "9", customer_name: "Northwind" },
    ]).map((group) => group.key)).toEqual(["name:northwind", "id:9"]);
  });

  it("orders customers and their projects by newest project id, breaking ties by id desc", () => {
    const groups = groupCustomers(pickerProjects, "newest");
    expect(groups.map((group) => group.key)).toEqual(["id:4", "id:3", "id:1", "id:2", "none"]);
    expect(groups[0].projects.map((project) => project.id)).toEqual(["200", "12"]);
    expect(groups[1].projects.map((project) => project.id)).toEqual(["100", "5"]);
    expect(groups[2].projects.map((project) => project.id)).toEqual(["30", "10"]);
    expect(groups[3].projects.map((project) => project.id)).toEqual(["25", "20", "18"]);
  });

  it("orders by most recently updated, breaking equal timestamps by project id desc", () => {
    const groups = groupCustomers(pickerProjects, "updated");
    expect(groups.map((group) => group.key)).toEqual(["id:1", "id:2", "id:4", "id:3", "none"]);
    expect(groups[0].projects.map((project) => project.id)).toEqual(["30", "10"]);
    expect(groups[2].projects.map((project) => project.id)).toEqual(["12", "200"]);
    expect(groups[3].projects.map((project) => project.id)).toEqual(["5", "100"]);
    expect(groups[3].projects.map((project) => project.name)).toEqual(["Annex", "Plant"]);
  });

  it("orders A-Z and breaks equal names by newest project id desc", () => {
    const groups = groupCustomers(pickerProjects, "az");
    expect(groups.map((group) => group.key)).toEqual(["id:1", "id:2", "id:4", "none", "id:3"]);
    expect(groups[1].projects.map((project) => project.name)).toEqual(["Alpha", "Yard", "yard"]);
    expect(groups[1].projects.map((project) => project.id)).toEqual(["25", "20", "18"]);
    expect(groups[3].name).toBe(NO_CUSTOMER_LABEL);
  });

  it("builds a hint from the newest project's date and omits a date that does not parse", () => {
    const groups = groupCustomers(pickerProjects, "newest");
    expect(groups.find((group) => group.key === "id:1")?.label).toBe("Acme (2 projects, newest Oct 7)");
    expect(groups.find((group) => group.key === "id:3")?.label).toBe("Zeta (2 projects, newest Jan 1)");
    expect(groups.find((group) => group.key === "none")?.label).toBe("No customer (1 project)");
    expect(
      customerOptionLabel("Acquisition.com", [
        { id: "2", name: "Old", updated_at: "2026-01-02" },
        { id: "9", name: "New", updated_at: "2026-10-07 15:04:05" },
      ]),
    ).toBe("Acquisition.com (2 projects, newest Oct 7)");
    expect(
      customerOptionLabel("Acquisition.com", [
        { id: "2", name: "Old", updated_at: "2026-10-07 08:00:00" },
        { id: "9", name: "New", updated_at: "not-a-date" },
      ]),
    ).toBe("Acquisition.com (2 projects)");
    expect(
      customerOptionLabel("Acquisition.com", [{ id: "9", name: "New", updated_at: "2026-02-31" }]),
    ).toBe("Acquisition.com (1 project)");
  });
});
