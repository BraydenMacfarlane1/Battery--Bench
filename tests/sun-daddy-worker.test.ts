import { describe, expect, it } from "vitest";
import type { AssetBinding } from "../worker/index";
import { handleRequest } from "../worker/index";
import { SUN_DADDY_NOT_CONFIGURED } from "../src/sun-daddy/types";

const assets: AssetBinding = {
  fetch: async () => new Response("asset"),
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Sun Daddy proxy", () => {
  it("says the export is not configured and does not call upstream", async () => {
    let called = false;
    const fetchImpl: typeof fetch = async () => {
      called = true;
      return jsonResponse({});
    };
    const response = await handleRequest(
      new Request("https://bess.example/api/sun-daddy/projects?q=test"),
      { ASSETS: assets },
      fetchImpl,
    );
    expect(response.status).toBe(503);
    expect(called).toBe(false);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe(SUN_DADDY_NOT_CONFIGURED);
  });

  it("proxies the project list with the server token and a custom base URL", async () => {
    const seen: { url: string; authorization: string | null }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      seen.push({ url: request.url, authorization: request.headers.get("authorization") });
      return jsonResponse([
        { id: "proj_a", name: "Alpha" },
        { project_id: "proj_b", title: "Beta" },
      ]);
    };
    const response = await handleRequest(
      new Request("https://bess.example/api/sun-daddy/projects?q=alpha"),
      { ASSETS: assets, SUN_DADDY_EXPORT_TOKEN: "test-token", SUN_DADDY_BASE_URL: "https://export.example.test/" },
      fetchImpl,
    );
    expect(response.status).toBe(200);
    expect(seen).toEqual([
      {
        url: "https://export.example.test/api/export/projects?q=alpha",
        authorization: "Bearer test-token",
      },
    ]);
    const body = (await response.json()) as { projects: { id: string; name: string }[] };
    expect(body.projects).toEqual([
      { id: "proj_a", name: "Alpha" },
      { id: "proj_b", name: "Beta" },
    ]);
  });

  it("normalizes a project and a battery catalog", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/api/export/batteries")) {
        return jsonResponse({
          batteries: [
            {
              id: "b1",
              name: "Cabinet",
              usable_capacity_kwh: 10,
              max_charge_rate_kw: 5,
              max_discharge_rate_kw: 5,
              cost_per_unit: 1000,
              round_trip_efficiency: null,
            },
          ],
        });
      }
      return jsonResponse({
        schema_version: 1,
        project: { id: "proj_synthetic", name: "Synthetic", economics: { discount_rate: 6, analysis_period: 15 } },
        rates: { pre: { rate: { name: "Flat synthetic", fixed_monthly_charge: 10 }, nem_rate: { export_credit_kwh: 0.03 } } },
      });
    };
    const project = await handleRequest(
      new Request("https://bess.example/api/sun-daddy/project/proj_synthetic"),
      { ASSETS: assets, SUN_DADDY_EXPORT_TOKEN: "test-token" },
      fetchImpl,
    );
    expect(project.status).toBe(200);
    const projectBody = (await project.json()) as {
      normalized: { project_id: string | null; economics: { discount_rate: number | null }; pre_rate: { rate: { export_credit_kwh: number; fixed_monthly_charge: number } | null } };
    };
    expect(projectBody.normalized.project_id).toBe("proj_synthetic");
    expect(projectBody.normalized.economics.discount_rate).toBeCloseTo(0.06);
    expect(projectBody.normalized.pre_rate.rate?.fixed_monthly_charge).toBe(10);
    expect(projectBody.normalized.pre_rate.rate?.export_credit_kwh).toBe(0.03);

    const batteries = await handleRequest(
      new Request("https://bess.example/api/sun-daddy/batteries"),
      { ASSETS: assets, SUN_DADDY_EXPORT_TOKEN: "test-token" },
      fetchImpl,
    );
    const batteryBody = (await batteries.json()) as { batteries: { round_trip_efficiency: number }[] };
    expect(batteryBody.batteries[0].round_trip_efficiency).toBe(0.9);
  });

  it("forwards numeric project ids to /api/export/project/:id", async () => {
    const seen: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      seen.push(url);
      if (url.includes("/api/export/projects")) {
        return jsonResponse({
          projects: [
            {
              id: 93,
              name: "Solar + Battery - Carport",
              label: "Synthetic carport",
              project_type: "solar_battery",
              status: "complete",
              customer_id: 80,
              customer_name: "Synthetic Customer",
              site_address: "100 Synthetic Way",
              utility: "Synthetic Power",
              pre_rate_id: null,
              updated_at: "2026-03-02 12:00:00",
            },
            { id: "proj_b", name: "String id" },
          ],
        });
      }
      if (url.endsWith("/api/export/project/93")) {
        return jsonResponse({
          schema_version: 1,
          project: {
            economics: {
              id: 93,
              name: "Solar + Battery - Carport",
              discount_rate: 6.0,
              analysis_period: 20,
              batteries: [{ battery_id: 7, quantity: 2, charge_source: "solar" }],
            },
          },
          batteries: [
            {
              id: 7,
              name: "Synthetic cabinet",
              usable_capacity_kwh: 10,
              max_charge_rate_kw: 5,
              max_discharge_rate_kw: 5,
              cost_per_unit: 1000,
              round_trip_efficiency: null,
            },
          ],
        });
      }
      if (url.endsWith("/api/export/batteries")) {
        return jsonResponse({
          batteries: [
            {
              id: 7,
              name: "Synthetic cabinet",
              usable_capacity_kwh: 10,
              max_charge_rate_kw: 5,
              max_discharge_rate_kw: 5,
              cost_per_unit: 1000,
              cost_per_additional_unit: 800,
              round_trip_efficiency: null,
            },
          ],
        });
      }
      return jsonResponse({ error: "unexpected" }, 500);
    };
    const env = { ASSETS: assets, SUN_DADDY_EXPORT_TOKEN: "test-token", SUN_DADDY_BASE_URL: "https://export.example.test" };
    const list = await handleRequest(new Request("https://bess.example/api/sun-daddy/projects"), env, fetchImpl);
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as { projects: { id: string; name: string }[]; warnings: string[] };
    expect(listBody.warnings).toEqual([]);
    expect(listBody.projects).toEqual([
      { id: "93", name: "Solar + Battery - Carport" },
      { id: "proj_b", name: "String id" },
    ]);

    const project = await handleRequest(new Request("https://bess.example/api/sun-daddy/project/93"), env, fetchImpl);
    expect(project.status).toBe(200);
    const projectBody = (await project.json()) as {
      normalized: { project_id: string | null; batteries: { id: string }[]; economics: { discount_rate: number | null } };
    };
    expect(projectBody.normalized.project_id).toBe("93");
    expect(projectBody.normalized.batteries[0].id).toBe("7");
    expect(projectBody.normalized.economics.discount_rate).toBeCloseTo(0.06);

    const batteries = await handleRequest(new Request("https://bess.example/api/sun-daddy/batteries"), env, fetchImpl);
    const batteryBody = (await batteries.json()) as { batteries: { id: string; round_trip_efficiency: number }[] };
    expect(batteryBody.batteries[0].id).toBe("7");
    expect(batteryBody.batteries[0].round_trip_efficiency).toBe(0.9);
    expect(seen).toEqual([
      "https://export.example.test/api/export/projects",
      "https://export.example.test/api/export/project/93",
      "https://export.example.test/api/export/batteries",
    ]);
  });

  it("does not echo the token when Sun Daddy rejects it", async () => {
    const fetchImpl: typeof fetch = async () => jsonResponse({ error: "nope" }, 401);
    const response = await handleRequest(
      new Request("https://bess.example/api/sun-daddy/batteries"),
      { ASSETS: assets, SUN_DADDY_EXPORT_TOKEN: "super-secret-token" },
      fetchImpl,
    );
    expect(response.status).toBe(502);
    const text = await response.text();
    expect(text).toContain("rejected the export token");
    expect(text).not.toContain("super-secret-token");
  });
});
