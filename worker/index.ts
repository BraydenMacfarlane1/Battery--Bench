import { GROSS_DEMAND_DISCLAIMER } from "../src/sizing/copy";
import { sizeBessSnapshot } from "../src/sizing/engine";
import {
  CUSTOMER_CHARGE_USD_MO,
  ENERGY_USD_PER_KWH,
  RMP_SCHED_6_STAMP,
  SCHEDULE_CODE,
  demandRate,
} from "../src/sizing/tariff";

export type AssetBinding = {
  fetch(request: Request): Promise<Response>;
};

function json(body: unknown, status = 200, cache = "no-store"): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": cache,
    },
  });
}

export async function handleRequest(request: Request, env: { ASSETS: AssetBinding }): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/api/health") {
    return json({ ok: true, worker: "bess-sizer", use_case: "peak_shave" });
  }

  if (url.pathname === "/api/tariff") {
    const summer = demandRate("summer");
    const winter = demandRate("winter");
    return json(
      {
        schedule: SCHEDULE_CODE,
        as_of: RMP_SCHED_6_STAMP.asOf,
        customer_charge_usd_mo: CUSTOMER_CHARGE_USD_MO,
        facilities_usd_per_kw: RMP_SCHED_6_STAMP.facilitiesUsdPerKw,
        power_usd_per_kw: RMP_SCHED_6_STAMP.powerUsdPerKw,
        demand_usd_per_kw_mo: { summer: summer.usdPerKwMo, winter: winter.usdPerKwMo },
        energy_usd_per_kwh: ENERGY_USD_PER_KWH,
        energy_shift: "TODO",
        disclaimer: GROSS_DEMAND_DISCLAIMER,
      },
      200,
      "public, max-age=3600",
    );
  }

  if (url.pathname === "/api/size") {
    if (request.method !== "POST") {
      return json({ error: "POST a sun-daddy.bess-snapshot.v1 body." }, 405);
    }
    const declaredLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > 2_000_000) {
      return json({ error: "Snapshot is too large." }, 413);
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Expected a JSON snapshot." }, 400);
    }
    try {
      return json(sizeBessSnapshot(body));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sizing failed.";
      return json({ error: message }, 400);
    }
  }

  if (url.pathname.startsWith("/api/")) {
    return json({ error: "Not found." }, 404);
  }

  return env.ASSETS.fetch(request);
}

export default {
  fetch(request: Request, env: { ASSETS: AssetBinding }) {
    return handleRequest(request, env);
  },
};
