import { afterEach, describe, expect, it, vi } from "vitest";
import { ChurchToolsOAuthClient, ChurchToolsOAuthError } from "../src/oauth/churchtoolsOAuthClient.js";
import { testConfig } from "./helpers.js";

const oauthConfig = {
  ...testConfig,
  churchToolsOAuthClientId: "client-id",
  churchToolsOAuthClientSecret: "client-secret",
  churchToolsOAuthAuthorizeUrl: "https://example.church.tools/oauth/authorize",
  churchToolsOAuthTokenUrl: "https://example.church.tools/oauth/access_token"
};

describe("ChurchToolsOAuthClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses ChurchTools OAuth userinfo as the default profile endpoint", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ id: "person-1" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new ChurchToolsOAuthClient(oauthConfig);
    await expect(client.loadProfile("access-token")).resolves.toEqual({ id: "person-1" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.church.tools/oauth/userinfo",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer access-token"
        })
      })
    );
  });

  it("returns safe token endpoint diagnostics for ChurchTools OAuth errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            error: "invalid_grant",
            error_description: "The authorization code is invalid or expired."
          }),
          {
            status: 400,
            headers: { "content-type": "application/json" }
          }
        )
      )
    );

    const client = new ChurchToolsOAuthClient(oauthConfig);

    await expect(client.exchangeAuthorizationCode("code", "https://mcp.example.org/oauth/churchtools/callback"))
      .rejects.toMatchObject({
        name: "ChurchToolsOAuthError",
        phase: "token",
        status: 400,
        upstreamError: "invalid_grant",
        message:
          "ChurchTools OAuth token request failed with status 400: invalid_grant: The authorization code is invalid or expired."
      } satisfies Partial<ChurchToolsOAuthError>);
  });
});
