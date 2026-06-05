import { describe, expect, it, vi } from "vitest";
import { ChurchToolsApi, createChurchToolsAuthorizationHeader } from "../src/services/churchtoolsApi.js";
import { PatChurchToolsCredentialsProvider } from "../src/services/credentials.js";
import { testConfig } from "./helpers.js";

describe("ChurchToolsApi", () => {
  it("creates Login authorization headers", () => {
    expect(createChurchToolsAuthorizationHeader("abc")).toBe("Login abc");
  });

  it("sends PAT auth and query params through the wrapped client transport", async () => {
    const request = vi.fn(async () => ({ data: { ok: true } }));
    const api = new ChurchToolsApi(testConfig, new PatChurchToolsCredentialsProvider("ct-token"), {
      axios: { request } as never,
      buildUrl: (path) => `https://example.church.tools/api${path}`
    });

    await api.request({
      method: "GET",
      path: "/persons",
      query: { "ids[]": [1, 2], active: true }
    });

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        url: "https://example.church.tools/api/persons?ids%5B%5D=1&ids%5B%5D=2&active=true",
        headers: expect.objectContaining({
          Authorization: "Login ct-token",
          "X-OnlyAuthenticated": "1"
        })
      })
    );
  });
});
