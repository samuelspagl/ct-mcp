import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { describe, expect, it } from "vitest";
import { OAuthIdentityRequester } from "../src/oauth/oauthIdentityRequester.js";
import { nowSeconds, OAuthTokenStore } from "../src/oauth/tokenStore.js";

const ENCRYPTION_SECRET = "token-encryption-key-with-32-characters";
const TOKEN_HASH_SECRET = "mcp-token-signing-secret-with-32-chars";

const authInfo: AuthInfo = {
  token: "mcp-access",
  clientId: "client-1",
  scopes: ["churchtools"],
  expiresAt: nowSeconds() + 900,
  extra: {
    userId: "person-1"
  }
};

describe("OAuth identity requester", () => {
  it("serves whoami from stored OAuth userinfo", async () => {
    const store = new OAuthTokenStore(":memory:", ENCRYPTION_SECRET, TOKEN_HASH_SECRET);
    store.saveChurchToolsTokens(
      "person-1",
      {
        accessToken: "ct-oauth-access",
        refreshToken: "ct-oauth-refresh",
        expiresAt: nowSeconds() + 3600,
        tokenType: "Bearer"
      },
      { id: "person-1", email: "person@example.org" }
    );
    const requester = new OAuthIdentityRequester(store);

    await expect(requester.request({ method: "GET", path: "/whoami" }, authInfo)).resolves.toEqual({
      data: {
        id: "person-1",
        email: "person@example.org",
        authentication: {
          mode: "oauth",
          source: "/oauth/userinfo"
        }
      }
    });

    store.close();
  });

  it("rejects REST API calls because ChurchTools OAuth tokens do not authorize /api", async () => {
    const store = new OAuthTokenStore(":memory:", ENCRYPTION_SECRET, TOKEN_HASH_SECRET);
    const requester = new OAuthIdentityRequester(store);

    await expect(requester.request({ method: "GET", path: "/persons" }, authInfo)).rejects.toThrow(
      "ChurchTools OAuth access tokens are valid for OAuth endpoints"
    );

    store.close();
  });
});
