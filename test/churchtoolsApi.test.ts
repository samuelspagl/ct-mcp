import { describe, expect, it, vi } from "vitest";
import { ChurchToolsApi, createChurchToolsAuthorizationHeader } from "../src/services/churchtoolsApi.js";
import {
  FORWARDED_CHURCHTOOLS_PAT_EXTRA_KEY,
  ForwardedPatChurchToolsCredentialsProvider
} from "../src/services/credentials.js";
import { testConfig } from "./helpers.js";

describe("ChurchToolsApi", () => {
  it("creates Login authorization headers", () => {
    expect(createChurchToolsAuthorizationHeader("abc")).toBe("Login abc");
  });

  it("sends PAT auth and query params through the wrapped client transport", async () => {
    const request = vi.fn(async () => ({ data: { ok: true } }));
    const api = new ChurchToolsApi(testConfig, {
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

  it("uses a forwarded PAT for ChurchTools API requests", async () => {
    const request = vi.fn(async () => ({ data: { ok: true } }));
    const api = new ChurchToolsApi(
      {
        churchToolsBaseUrl: testConfig.churchToolsBaseUrl,
        requestTimeoutMs: testConfig.requestTimeoutMs
      },
      new ForwardedPatChurchToolsCredentialsProvider(),
      {
        axios: { request } as never,
        buildUrl: (path) => `https://example.church.tools/api${path}`
      }
    );

    await api.request(
      {
        method: "GET",
        path: "/whoami"
      },
      {
        authInfo: {
          token: "mcp-token",
          clientId: "client",
          scopes: ["churchtools"],
          extra: {
            [FORWARDED_CHURCHTOOLS_PAT_EXTRA_KEY]: "user-pat"
          }
        }
      }
    );

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Login user-pat"
        })
      })
    );
  });
});
