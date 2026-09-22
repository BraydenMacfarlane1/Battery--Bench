import { describe, expect, it } from "vitest";
import fixtureA from "../src/fixtures/example-a.snapshot.json";
import { GROSS_DEMAND_DISCLAIMER } from "../src/sizing/copy";
import { handleRequest, type AssetBinding } from "../worker/index";
import { expectedExampleA } from "./expected-a";

const assets: AssetBinding = {
  fetch: async () => new Response("asset"),
};

describe("bess-sizer worker", () => {
  it("locks fixture A on POST /api/size", async () => {
    const response = await handleRequest(
      new Request("https://bess-sizer.example/api/size", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(fixtureA),
      }),
      { ASSETS: assets },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expectedExampleA);
  });

  it("publishes the gross-demand disclaimer with the tariff stamp", async () => {
    const response = await handleRequest(new Request("https://bess-sizer.example/api/tariff"), { ASSETS: assets });
    const body = (await response.json()) as { as_of: string; demand_usd_per_kw_mo: { summer: number }; disclaimer: string };
    expect(body.as_of).toBe("2026-08-10");
    expect(body.demand_usd_per_kw_mo.summer).toBe(18.85);
    expect(body.disclaimer).toBe(GROSS_DEMAND_DISCLAIMER);
  });
});
