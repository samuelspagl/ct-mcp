import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { isAuthorizedHeader, isAuthorizedRequest, requireMcpAuth, readForwardedChurchToolsPat } from "../src/http/auth.js";
import { FORWARDED_CHURCHTOOLS_PAT_EXTRA_KEY } from "../src/services/credentials.js";
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

  it("requires a forwarded ChurchTools PAT in PAT forwarding mode", () => {
    const config = { ...testConfig, churchToolsAuthMode: "pat-forwarding" as const };

    expect(isAuthorizedRequest(request({ authorization: "Bearer mcp-token" }), config)).toBe(false);
    expect(
      isAuthorizedRequest(
        request({
          authorization: "Bearer mcp-token",
          "x-churchtools-pat": "user-pat"
        }),
        config
      )
    ).toBe(true);
  });

  it("attaches forwarded PAT to MCP auth context without using it as MCP token", () => {
    const config = { ...testConfig, churchToolsAuthMode: "pat-forwarding" as const };
    const req = request({
      authorization: "Bearer mcp-token",
      "x-churchtools-pat": "user-pat"
    }) as Request & { auth?: AuthInfo };
    const next = vi.fn();

    requireMcpAuth(config)(req, response(), next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.auth?.token).toBe("mcp-token");
    expect(req.auth?.extra?.[FORWARDED_CHURCHTOOLS_PAT_EXTRA_KEY]).toBe("user-pat");
  });

  it("trims the forwarded PAT header", () => {
    expect(readForwardedChurchToolsPat(request({ "x-churchtools-pat": " user-pat " }))).toBe("user-pat");
  });
});

function request(headers: Record<string, string>): Request {
  return {
    header: (name: string) => headers[name.toLowerCase()]
  } as Request;
}

function response(): Response {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn()
  } as unknown as Response;
}
