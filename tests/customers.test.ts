import { describe, expect, it } from "vitest";
import { NO_CUSTOMER_LABEL, groupProjectsByCustomer } from "../src/sun-daddy/customers";
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
