import { normalizeBatteryCatalog, normalizeProjectExport, normalizeProjectList } from "./normalize";
import { SUN_DADDY_NOT_CONFIGURED } from "./types";

export const DEFAULT_SUN_DADDY_BASE_URL = "https://commercial-app.pages.dev";

export type SunDaddyEnv = {
  SUN_DADDY_EXPORT_TOKEN?: string;
  SUN_DADDY_BASE_URL?: string;
};

export function sunDaddyBaseUrl(env: SunDaddyEnv): string {
  const configured = env.SUN_DADDY_BASE_URL?.trim();
  const base = configured && configured.length > 0 ? configured : DEFAULT_SUN_DADDY_BASE_URL;
  return base.replace(/\/+$/, "");
}

/** Sun Daddy routes, or null when the path belongs to the rest of the worker. */
export async function handleSunDaddy(
  request: Request,
  env: SunDaddyEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<Response | null> {
  const url = new URL(request.url);
  const projectId = /^\/api\/sun-daddy\/project\/([^/]+)$/.exec(url.pathname)?.[1];
  const isProjects = url.pathname === "/api/sun-daddy/projects";
  const isBatteries = url.pathname === "/api/sun-daddy/batteries";
  if (!isProjects && !isBatteries && !projectId) return null;

  if (request.method !== "GET") return json({ error: "Use GET." }, 405);
  const token = env.SUN_DADDY_EXPORT_TOKEN?.trim();
  if (!token) return json({ error: SUN_DADDY_NOT_CONFIGURED }, 503);

  // Live export ids are integers ("93"). Older fixtures use strings. Both are path segments.
  if (projectId && !/^[A-Za-z0-9_-]{1,128}$/.test(projectId)) {
    return json({ error: "Project id must be letters, numbers, hyphens, or underscores." }, 400);
  }

  const upstreamPath = isProjects
    ? "/api/export/projects"
    : isBatteries
      ? "/api/export/batteries"
      : `/api/export/project/${projectId}`;
  const upstream = new URL(upstreamPath, `${sunDaddyBaseUrl(env)}/`);
  if (isProjects && url.searchParams.get("q")) upstream.searchParams.set("q", url.searchParams.get("q") ?? "");

  let response: Response;
  try {
    response = await fetchImpl(upstream, {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
      },
    });
  } catch {
    return json({ error: "Sun Daddy export could not be reached." }, 502);
  }

  if (response.status === 401 || response.status === 403) {
    return json({ error: "Sun Daddy rejected the export token." }, 502);
  }
  if (!response.ok) {
    return json({ error: `Sun Daddy export failed (${response.status}).` }, 502);
  }

  const text = await response.text();
  if (text.length > 8_000_000) return json({ error: "Sun Daddy export is too large." }, 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: "Sun Daddy export was not JSON." }, 502);
  }

  if (isProjects) return json(normalizeProjectList(body));
  if (isBatteries) return json(normalizeBatteryCatalog(body));
  return json({ normalized: normalizeProjectExport(body) });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
