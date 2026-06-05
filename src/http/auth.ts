import type { Request, RequestHandler } from "express";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { AppConfig } from "../config.js";
import { FORWARDED_CHURCHTOOLS_PAT_EXTRA_KEY, FORWARDED_CHURCHTOOLS_PAT_HEADER } from "../services/credentials.js";

export function isAuthorizedHeader(authorizationHeader: string | undefined, config: AppConfig): boolean {
  if (config.allowUnauthenticatedMcp) {
    return true;
  }

  if (!config.mcpServerToken) {
    return false;
  }

  return authorizationHeader === `Bearer ${config.mcpServerToken}`;
}

export function isAuthorizedRequest(req: Request, config: AppConfig): boolean {
  if (!isAuthorizedHeader(req.header("authorization"), config)) {
    return false;
  }

  if (config.churchToolsAuthMode === "pat-forwarding") {
    return Boolean(readForwardedChurchToolsPat(req));
  }

  return true;
}

export function requireMcpAuth(config: AppConfig): RequestHandler {
  return (req, res, next) => {
    if (isAuthorizedRequest(req, config)) {
      attachPatForwardingAuthInfo(req, config);
      next();
      return;
    }

    res.status(401).json({
      error: "unauthorized",
      message:
        config.churchToolsAuthMode === "pat-forwarding"
          ? `Missing or invalid MCP bearer token, or missing ${FORWARDED_CHURCHTOOLS_PAT_HEADER} header.`
          : "Missing or invalid MCP bearer token."
    });
  };
}

export function readForwardedChurchToolsPat(req: Pick<Request, "header">): string | undefined {
  const value = req.header(FORWARDED_CHURCHTOOLS_PAT_HEADER);
  const token = typeof value === "string" ? value.trim() : "";
  return token.length > 0 ? token : undefined;
}

function attachPatForwardingAuthInfo(req: Request, config: AppConfig): void {
  if (config.churchToolsAuthMode !== "pat-forwarding") {
    return;
  }

  const pat = readForwardedChurchToolsPat(req);
  if (!pat) {
    return;
  }

  const authInfo: AuthInfo = {
    token: config.mcpServerToken ?? "unauthenticated",
    clientId: "pat-forwarding",
    scopes: ["churchtools"],
    extra: {
      [FORWARDED_CHURCHTOOLS_PAT_EXTRA_KEY]: pat
    }
  };

  (req as Request & { auth?: AuthInfo }).auth = authInfo;
}
