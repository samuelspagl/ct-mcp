import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { describe, expect, it } from "vitest";
import {
  FORWARDED_CHURCHTOOLS_PAT_EXTRA_KEY,
  ForwardedPatChurchToolsCredentialsProvider,
  StaticChurchToolsCredentialsProvider,
  getForwardedChurchToolsPat
} from "../src/services/credentials.js";

const authInfo: AuthInfo = {
  token: "mcp-token",
  clientId: "client",
  scopes: ["churchtools"],
  extra: {
    [FORWARDED_CHURCHTOOLS_PAT_EXTRA_KEY]: "user-pat"
  }
};

describe("ChurchTools credentials", () => {
  it("returns static PAT credentials", async () => {
    await expect(new StaticChurchToolsCredentialsProvider("static-pat").getCredentials()).resolves.toEqual({
      type: "login",
      token: "static-pat"
    });
  });

  it("returns forwarded PAT credentials from MCP auth info", async () => {
    await expect(new ForwardedPatChurchToolsCredentialsProvider().getCredentials(authInfo)).resolves.toEqual({
      type: "login",
      token: "user-pat"
    });
  });

  it("does not invent forwarded PAT credentials without auth context", async () => {
    await expect(new ForwardedPatChurchToolsCredentialsProvider().getCredentials()).rejects.toThrow(
      "Missing forwarded ChurchTools PAT"
    );
  });

  it("extracts forwarded PAT values from auth info", () => {
    expect(getForwardedChurchToolsPat(authInfo)).toBe("user-pat");
    expect(getForwardedChurchToolsPat({ ...authInfo, extra: {} })).toBeUndefined();
  });
});
