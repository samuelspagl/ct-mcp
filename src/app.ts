import { randomUUID } from "node:crypto";
import {
  getOAuthProtectedResourceMetadataUrl,
  mcpAuthRouter
} from "@modelcontextprotocol/sdk/server/auth/router.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type Express } from "express";
import type { AppConfig } from "./config.js";
import { parseConfig } from "./config.js";
import { requireMcpAuth, requireOAuthMcpAuth } from "./http/auth.js";
import { createChurchToolsMcpServer } from "./mcp/server.js";
import { ChurchToolsOAuthClient, ChurchToolsOAuthError } from "./oauth/churchtoolsOAuthClient.js";
import { OAuthIdentityRequester } from "./oauth/oauthIdentityRequester.js";
import { McpOAuthProvider } from "./oauth/mcpOAuthProvider.js";
import { OAuthTokenStore } from "./oauth/tokenStore.js";
import { ChurchToolsApi } from "./services/churchtoolsApi.js";
import { PatChurchToolsCredentialsProvider } from "./services/credentials.js";
import { OpenApiCatalog } from "./services/openApiCatalog.js";
import type { ChurchToolsRequester } from "./types.js";

export interface CreateAppOptions {
  config?: AppConfig;
  api?: ChurchToolsRequester;
  catalog?: OpenApiCatalog;
}

export interface CreatedApp {
  app: Express;
  config: AppConfig;
  catalog: OpenApiCatalog;
  oauthTokenStore?: OAuthTokenStore;
}

export async function createApp(options: CreateAppOptions = {}): Promise<CreatedApp> {
  const config = options.config ?? parseConfig();
  const catalog = options.catalog ?? (await OpenApiCatalog.load(config.churchToolsOpenApiUrl));
  const oauthContext = config.churchToolsAuthMode === "oauth" ? createOAuthContext(config) : undefined;
  const api =
    options.api ??
    (oauthContext
      ? new OAuthIdentityRequester(oauthContext.tokenStore)
      : new ChurchToolsApi(config, new PatChurchToolsCredentialsProvider(requiredPat(config))));
  const mcpServer = createChurchToolsMcpServer({ config, api, catalog });

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "2mb" }));

  if (oauthContext) {
    app.use(
      mcpAuthRouter({
        provider: oauthContext.provider,
        issuerUrl: oauthContext.provider.issuerUrl,
        baseUrl: oauthContext.provider.issuerUrl,
        resourceServerUrl: oauthContext.provider.resourceServerUrl,
        resourceName: "ChurchTools MCP Server",
        scopesSupported: ["churchtools"]
      })
    );

    app.get("/oauth/churchtools/callback", async (req, res) => {
      const code = typeof req.query.code === "string" ? req.query.code : undefined;
      const state = typeof req.query.state === "string" ? req.query.state : undefined;
      const upstreamError = typeof req.query.error === "string" ? req.query.error : undefined;
      const upstreamErrorDescription =
        typeof req.query.error_description === "string" ? req.query.error_description : undefined;
      if (upstreamError) {
        res.status(400).json({
          error: upstreamError,
          message: upstreamErrorDescription || "ChurchTools rejected the OAuth authorization request."
        });
        return;
      }
      if (!code || !state) {
        res.status(400).json({ error: "invalid_request", message: "Missing ChurchTools OAuth code or state." });
        return;
      }

      try {
        res.redirect(302, await oauthContext.provider.handleChurchToolsCallback(code, state));
      } catch (error) {
        const safeError = describeOAuthCallbackError(error);
        console.error("ChurchTools OAuth callback failed", safeError);
        res.status(400).json({
          error: "invalid_grant",
          message: safeError.message,
          phase: safeError.phase,
          ...(safeError.status ? { status: safeError.status } : {}),
          ...(safeError.upstreamError ? { upstream_error: safeError.upstreamError } : {})
        });
      }
    });

    app.post(
      "/oauth/disconnect",
      requireOAuthMcpAuth(
        oauthContext.provider,
        getOAuthProtectedResourceMetadataUrl(oauthContext.provider.resourceServerUrl)
      ),
      (req, res) => {
        const userId = req.auth?.extra?.userId;
        if (typeof userId !== "string" || userId.length === 0) {
          res.status(401).json({ error: "unauthorized", message: "Missing OAuth user context." });
          return;
        }

        oauthContext.tokenStore.revokeUser(userId);
        res.status(204).send();
      }
    );
  }

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/ready", (_req, res) => {
    res.json({
      status: "ready",
      operations: catalog.operations.length
    });
  });

  app.post("/mcp", oauthContext ? oauthContext.requireAuth : requireMcpAuth(config), async (req, res) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined
    });
    const requestId = randomUUID();

    res.on("close", () => {
      void transport.close();
    });

    try {
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error(`[${requestId}] MCP request failed`, error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal MCP server error."
          },
          id: req.body?.id ?? null
        });
      }
    }
  });

  return { app, config, catalog, ...(oauthContext ? { oauthTokenStore: oauthContext.tokenStore } : {}) };
}

function createOAuthContext(config: AppConfig): {
  churchToolsOAuthClient: ChurchToolsOAuthClient;
  provider: McpOAuthProvider;
  requireAuth: express.RequestHandler;
  tokenStore: OAuthTokenStore;
} {
  if (!config.tokenEncryptionKey || !config.mcpTokenSigningSecret) {
    throw new Error("OAuth mode requires TOKEN_ENCRYPTION_KEY and MCP_TOKEN_SIGNING_SECRET.");
  }

  const tokenStore = new OAuthTokenStore(
    config.oauthTokenStorePath,
    config.tokenEncryptionKey,
    config.mcpTokenSigningSecret
  );
  const churchToolsOAuthClient = new ChurchToolsOAuthClient(config);
  const provider = new McpOAuthProvider(config, tokenStore, churchToolsOAuthClient);

  return {
    churchToolsOAuthClient,
    provider,
    requireAuth: requireOAuthMcpAuth(provider, getOAuthProtectedResourceMetadataUrl(provider.resourceServerUrl)),
    tokenStore
  };
}

function requiredPat(config: AppConfig): string {
  if (!config.churchToolsPat) {
    throw new Error("PAT mode requires CHURCHTOOLS_PAT.");
  }
  return config.churchToolsPat;
}

function describeOAuthCallbackError(error: unknown): {
  message: string;
  phase: string;
  status?: number;
  upstreamError?: string;
} {
  if (error instanceof ChurchToolsOAuthError) {
    return {
      message: error.message,
      phase: error.phase,
      ...(error.status ? { status: error.status } : {}),
      ...(error.upstreamError ? { upstreamError: error.upstreamError } : {})
    };
  }

  return {
    message: error instanceof Error ? error.message : "ChurchTools OAuth callback could not be completed.",
    phase: "callback"
  };
}
