import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchLeadForms, sanitizeMetaPayload } from "../src/index";

const env = {
  META_API_VERSION: "v26.0",
  META_AD_ACCOUNT_ID: "act_1242143730059500",
  META_BUSINESS_ID: "435078803026689",
  META_PAGE_ID: "435075943026975",
  META_PIXEL_ID: "1587609516129238",
  META_ACCESS_TOKEN: "system-user-token",
  META_APP_SECRET: "app-secret",
  META_APP_ID: "1021587770849906",
  MCP_ACCESS_KEY: "mcp-key",
} as Env;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sanitizeMetaPayload", () => {
  it("removes secrets recursively", () => {
    expect(sanitizeMetaPayload({
      access_token: "secret",
      nested: { appsecret_proof: "proof", id: "123" },
    })).toEqual({ nested: { id: "123" } });
  });

  it("removes signed pagination URLs while retaining cursors", () => {
    expect(sanitizeMetaPayload({
      paging: {
        next: "https://graph.facebook.com/v26.0/next?access_token=secret",
        previous: "https://graph.facebook.com/v26.0/previous?access_token=secret",
        cursors: { before: "before-cursor", after: "after-cursor" },
      },
    })).toEqual({
      paging: { cursors: { before: "before-cursor", after: "after-cursor" } },
    });
  });
});

describe("fetchLeadForms", () => {
  it("derives and uses a Page token without returning it", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{
          id: env.META_PAGE_ID,
          name: "White5",
          access_token: "page-token",
          tasks: ["MANAGE_LEADS"],
        }],
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{ id: "form-1", name: "Quote request", status: "ACTIVE" }],
      }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchLeadForms(env, 25);
    expect(result).toEqual({
      data: [{ id: "form-1", name: "Quote request", status: "ACTIVE" }],
    });
    expect(JSON.stringify(result)).not.toContain("page-token");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[0]![1]!.headers as Headers).get("authorization"))
      .toBe("Bearer system-user-token");
    expect((fetchMock.mock.calls[1]![1]!.headers as Headers).get("authorization"))
      .toBe("Bearer page-token");
  });
});
