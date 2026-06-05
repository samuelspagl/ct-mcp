import { describe, expect, it } from "vitest";
import { TokenEncryption } from "../src/oauth/crypto.js";
import { nowSeconds, OAuthTokenStore } from "../src/oauth/tokenStore.js";

const ENCRYPTION_SECRET = "token-encryption-key-with-32-characters";
const TOKEN_HASH_SECRET = "mcp-token-signing-secret-with-32-chars";

describe("OAuth token store", () => {
  it("encrypts and decrypts token values", () => {
    const encryption = new TokenEncryption(ENCRYPTION_SECRET);
    const encrypted = encryption.encrypt("churchtools-access-token");

    expect(encrypted).toBeTruthy();
    expect(encrypted).not.toContain("churchtools-access-token");
    expect(encryption.decrypt(encrypted)).toBe("churchtools-access-token");
  });

  it("stores encrypted ChurchTools tokens and revokes user material", () => {
    const store = new OAuthTokenStore(":memory:", ENCRYPTION_SECRET, TOKEN_HASH_SECRET);
    const expiresAt = nowSeconds() + 3600;

    store.saveChurchToolsTokens(
      "user-1",
      {
        accessToken: "ct-access",
        refreshToken: "ct-refresh",
        expiresAt,
        tokenType: "Bearer",
        scope: "churchtools"
      },
      { id: "user-1" }
    );

    const tokens = store.getChurchToolsTokens("user-1");
    expect(tokens).toMatchObject({
      userId: "user-1",
      accessToken: "ct-access",
      refreshToken: "ct-refresh",
      expiresAt,
      tokenType: "Bearer",
      scope: "churchtools"
    });

    const mcpAccessToken = store.saveAccessToken({
      clientId: "client-1",
      userId: "user-1",
      scopes: ["churchtools"],
      resource: "https://mcp.example.org/mcp",
      expiresAt
    });

    expect(store.getAccessToken(mcpAccessToken)).toMatchObject({
      token: mcpAccessToken,
      clientId: "client-1",
      scopes: ["churchtools"],
      expiresAt,
      extra: { userId: "user-1" }
    });

    store.revokeUser("user-1");

    expect(store.getChurchToolsTokens("user-1")).toBeUndefined();
    expect(store.getAccessToken(mcpAccessToken)).toBeUndefined();
    store.close();
  });
});
