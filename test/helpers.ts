import type { AppConfig } from "../src/config.js";

export const testConfig: AppConfig = {
  port: 3000,
  host: "127.0.0.1",
  logLevel: "silent",
  churchToolsBaseUrl: "https://example.church.tools",
  churchToolsAuthMode: "pat",
  churchToolsPat: "ct-token",
  churchToolsOpenApiUrl: "https://example.church.tools/system/runtime/swagger/openapi.json",
  allowUnauthenticatedMcp: false,
  mcpServerToken: "mcp-token",
  oauthTokenStorePath: ":memory:",
  mcpAccessTokenTtlSeconds: 900,
  mcpRefreshTokenTtlSeconds: 2_592_000,
  requestTimeoutMs: 30_000,
  maxResponseBytes: 100_000
};
