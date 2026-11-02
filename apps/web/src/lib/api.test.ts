import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

describe("api client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("includes the session cookie and unwraps collection envelopes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ contacts: [{ id: "c1" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(api<Array<{ id: string }>>("/api/contacts")).resolves.toEqual([{ id: "c1" }]);
    expect(fetchMock).toHaveBeenCalledWith("/api/contacts", expect.objectContaining({ credentials: "include" }));
  });

  it("preserves non-collection envelopes and reports structured API errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ call: { id: "call-1" } }), { status: 200 })));
    await expect(api<{ call: { id: string } }>("/api/history/call-1")).resolves.toEqual({ call: { id: "call-1" } });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "number is taken" } }), { status: 409 })));
    await expect(api("/api/numbers", { method: "POST" })).rejects.toThrow("number is taken");
  });
});
