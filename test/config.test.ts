import { describe, expect, it } from "vitest";
import { normalizeChurchToolsBaseUrl, parseConfig } from "../src/config.js";

describe("config", () => {
  it("parses required PAT configuration", () => {
    const config = parseConfig({
      CHURCHTOOLS_BASE_URL: "https://example.church.tools/api",
      CHURCHTOOLS_AUTH_MODE: "pat",
      CHURCHTOOLS_PAT: "ct-token",
      MCP_SERVER_TOKEN: "mcp-token"
    });

    expect(config.churchToolsBaseUrl).toBe("https://example.church.tools");
    expect(config.churchToolsOpenApiUrl).toBe(
      "https://example.church.tools/system/runtime/swagger/openapi.json"
    );
    expect(config.churchToolsPat).toBe("ct-token");
    expect(config.mcpServerToken).toBe("mcp-token");
  });

  it("requires an MCP server token unless unauthenticated MCP is explicitly allowed", () => {
    expect(() =>
      parseConfig({
        CHURCHTOOLS_BASE_URL: "https://example.church.tools",
        CHURCHTOOLS_AUTH_MODE: "pat",
        CHURCHTOOLS_PAT: "ct-token"
      })
    ).toThrow("MCP_SERVER_TOKEN is required");
  });

  it("names missing environment variables in startup errors", () => {
    expect(() => parseConfig({})).toThrow(
      [
        "Invalid environment:",
        "- CHURCHTOOLS_BASE_URL is required",
        "- CHURCHTOOLS_AUTH_MODE is required"
      ].join("\n")
    );
  });

  it("parses OAuth configuration", () => {
    const config = parseConfig({
      CHURCHTOOLS_BASE_URL: "https://example.church.tools",
      CHURCHTOOLS_AUTH_MODE: "oauth",
      PUBLIC_BASE_URL: "https://mcp.example.org",
      MCP_TOKEN_SIGNING_SECRET: "mcp-token-signing-secret-with-32-chars",
      TOKEN_ENCRYPTION_KEY: "token-encryption-key-with-32-characters",
      CHURCHTOOLS_OAUTH_CLIENT_ID: "client-id",
      CHURCHTOOLS_OAUTH_CLIENT_SECRET: "client-secret",
      CHURCHTOOLS_OAUTH_AUTHORIZE_URL: "https://example.church.tools/oauth/authorize",
      CHURCHTOOLS_OAUTH_TOKEN_URL: "https://example.church.tools/oauth/access_token"
    });

    expect(config.churchToolsAuthMode).toBe("oauth");
    expect(config.publicBaseUrl).toBe("https://mcp.example.org");
    expect(config.oauthTokenStorePath).toBe("./data/tokens.db");
    expect(config.churchToolsPat).toBeUndefined();
  });

  it("requires OAuth secrets in OAuth mode", () => {
    expect(() =>
      parseConfig({
        CHURCHTOOLS_BASE_URL: "https://example.church.tools",
        CHURCHTOOLS_AUTH_MODE: "oauth"
      })
    ).toThrow("PUBLIC_BASE_URL is required when CHURCHTOOLS_AUTH_MODE=oauth");
  });

  it("normalizes ChurchTools base URLs", () => {
    expect(normalizeChurchToolsBaseUrl("https://example.church.tools/api/")).toBe(
      "https://example.church.tools"
    );
    expect(normalizeChurchToolsBaseUrl("https://example.church.tools/api")).toBe(
      "https://example.church.tools"
    );
  });
});
