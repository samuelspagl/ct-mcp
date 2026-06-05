import type { Response } from "express";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import { describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../src/config.js";
import type { ChurchToolsOAuthClient } from "../src/oauth/churchtoolsOAuthClient.js";
import { McpOAuthProvider } from "../src/oauth/mcpOAuthProvider.js";
import { nowSeconds, OAuthTokenStore } from "../src/oauth/tokenStore.js";
import { testConfig } from "./helpers.js";

const ENCRYPTION_SECRET = "token-encryption-key-with-32-characters";
const TOKEN_HASH_SECRET = "mcp-token-signing-secret-with-32-chars";

const oauthConfig: AppConfig = {
  ...testConfig,
  churchToolsAuthMode: "oauth",
  churchToolsPat: undefined,
  publicBaseUrl: "https://mcp.example.org",
  mcpTokenSigningSecret: TOKEN_HASH_SECRET,
  tokenEncryptionKey: ENCRYPTION_SECRET,
  churchToolsOAuthClientId: "ct-client",
  churchToolsOAuthClientSecret: "ct-secret",
  churchToolsOAuthAuthorizeUrl: "https://example.church.tools/oauth/authorize",
  churchToolsOAuthTokenUrl: "https://example.church.tools/oauth/token"
};

const client: OAuthClientInformationFull = {
  client_id: "mcp-client",
  client_id_issued_at: nowSeconds(),
  redirect_uris: ["http://127.0.0.1:49152/oauth/callback"],
  token_endpoint_auth_method: "none"
};

describe("MCP OAuth provider", () => {
  it("bridges ChurchTools OAuth into server-issued MCP tokens", async () => {
    const store = new OAuthTokenStore(":memory:", ENCRYPTION_SECRET, TOKEN_HASH_SECRET);
    const churchToolsOAuthClient = {
      buildAuthorizeUrl: vi.fn((state: string, redirectUri: string) => {
        const url = new URL("https://example.church.tools/oauth/authorize");
        url.searchParams.set("state", state);
        url.searchParams.set("redirect_uri", redirectUri);
        return url.href;
      }),
      exchangeAuthorizationCode: vi.fn(async () => ({
        accessToken: "ct-access",
        refreshToken: "ct-refresh",
        expiresAt: nowSeconds() + 3600,
        tokenType: "Bearer",
        scope: "churchtools"
      })),
      loadProfile: vi.fn(async () => ({ id: "person-1" }))
    } as unknown as ChurchToolsOAuthClient;
    const provider = new McpOAuthProvider(oauthConfig, store, churchToolsOAuthClient);
    const redirect = vi.fn();
    const response = { redirect } as unknown as Response;

    await provider.authorize(
      client,
      {
        redirectUri: client.redirect_uris[0],
        codeChallenge: "pkce-code-challenge",
        scopes: ["churchtools"],
        state: "mcp-client-state",
        resource: provider.resourceServerUrl
      },
      response
    );

    expect(redirect).toHaveBeenCalledWith(302, expect.stringContaining("https://example.church.tools/oauth/authorize"));
    const churchToolsRedirect = new URL(redirect.mock.calls[0]?.[1] as string);
    expect(churchToolsRedirect.searchParams.get("redirect_uri")).toBe(
      "https://mcp.example.org/oauth/churchtools/callback"
    );

    const callbackRedirect = await provider.handleChurchToolsCallback(
      "churchtools-code",
      churchToolsRedirect.searchParams.get("state") as string
    );
    const callbackUrl = new URL(callbackRedirect);
    const authorizationCode = callbackUrl.searchParams.get("code");
    expect(callbackUrl.searchParams.get("state")).toBe("mcp-client-state");
    expect(authorizationCode).toBeTruthy();
    expect(store.getChurchToolsTokens("person-1")).toMatchObject({
      accessToken: "ct-access",
      refreshToken: "ct-refresh"
    });

    await expect(provider.challengeForAuthorizationCode(client, authorizationCode as string)).resolves.toBe(
      "pkce-code-challenge"
    );
    const mcpTokens = await provider.exchangeAuthorizationCode(
      client,
      authorizationCode as string,
      undefined,
      client.redirect_uris[0],
      provider.resourceServerUrl
    );
    const authInfo = await provider.verifyAccessToken(mcpTokens.access_token);

    expect(authInfo).toMatchObject({
      clientId: "mcp-client",
      scopes: ["churchtools"],
      extra: { userId: "person-1" }
    });
    expect(authInfo.token).not.toBe("ct-access");
    expect(mcpTokens.refresh_token).toBeTruthy();

    const refreshedMcpTokens = await provider.exchangeRefreshToken(
      client,
      mcpTokens.refresh_token as string,
      undefined,
      provider.resourceServerUrl
    );
    expect(refreshedMcpTokens.access_token).not.toBe(mcpTokens.access_token);
    await expect(provider.verifyAccessToken(refreshedMcpTokens.access_token)).resolves.toMatchObject({
      extra: { userId: "person-1" }
    });

    store.close();
  });
});
