import { describe, expect, it, vi } from "vitest";
import { isAuthorizedHeader, requireOAuthMcpAuth } from "../src/http/auth.js";
import { testConfig } from "./helpers.js";

describe("MCP auth", () => {
  it("accepts the configured bearer token", () => {
    expect(isAuthorizedHeader("Bearer mcp-token", testConfig)).toBe(true);
  });

  it("rejects missing or wrong bearer tokens", () => {
    expect(isAuthorizedHeader(undefined, testConfig)).toBe(false);
    expect(isAuthorizedHeader("Bearer wrong", testConfig)).toBe(false);
  });

  it("can be explicitly disabled for local development", () => {
    expect(isAuthorizedHeader(undefined, { ...testConfig, allowUnauthenticatedMcp: true })).toBe(true);
  });

  it("returns OAuth protected-resource metadata on missing OAuth bearer tokens", async () => {
    const middleware = requireOAuthMcpAuth(
      {
        verifyAccessToken: vi.fn()
      },
      "https://mcp.example.org/.well-known/oauth-protected-resource/mcp"
    );
    const req = { headers: {} };
    const res = {
      set: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis()
    };
    const next = vi.fn();

    await middleware(req as never, res as never, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.set).toHaveBeenCalledWith(
      "WWW-Authenticate",
      expect.stringContaining(
        'resource_metadata="https://mcp.example.org/.well-known/oauth-protected-resource/mcp"'
      )
    );
  });
});
