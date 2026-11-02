import { describe, expect, it, vi } from "vitest";
import { serveStaticAssets } from "./assets";

function assets() {
  return { ASSETS: { fetch: vi.fn(async () => new Response("<!doctype html><html><head></head><body>SPA</body></html>", { headers: { "content-type": "text/html", "cache-control": "public, max-age=60" } })) } } as never;
}

describe("record document privacy", () => {
  it.each(["/callrecords/private-meeting", "/callrecords/private-meeting?from=share", "/callrecords"])("marks the actual %s HTML response noindex", async (path) => {
    const response = await serveStaticAssets(new Request(`https://app.example${path}`), assets());
    expect(response.headers.get("content-type")).toBe("text/html");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toContain("<!doctype html>");
  });

  it("preserves ordinary asset caching and adds defensive headers", async () => {
    const response = await serveStaticAssets(new Request("https://app.example/assets/app.js"), assets());
    expect(response.headers.get("x-robots-tag")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
