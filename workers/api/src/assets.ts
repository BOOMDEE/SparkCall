import type { Env } from "./env";

/** Protect the actual document response, not only the record JSON endpoint. */
export async function serveStaticAssets(request: Request, env: Pick<Env, "ASSETS">): Promise<Response> {
  const response = await env.ASSETS.fetch(request);
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-frame-options", "DENY");
  const path = new URL(request.url).pathname;
  if (path === "/callrecords" || path.startsWith("/callrecords/")) {
    headers.set("x-robots-tag", "noindex, nofollow");
    headers.set("cache-control", "no-store");
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
