import { describe, expect, it } from "vitest";
import { sanitizeMetaPayload } from "../src/index";

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
