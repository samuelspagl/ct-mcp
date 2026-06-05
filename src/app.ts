import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type Express } from "express";
import type { AppConfig } from "./config.js";
import { parseConfig } from "./config.js";
import { requireMcpAuth } from "./http/auth.js";
import { createChurchToolsMcpServer } from "./mcp/server.js";
import { ChurchToolsApi } from "./services/churchtoolsApi.js";
import {
  ForwardedPatChurchToolsCredentialsProvider,
  StaticChurchToolsCredentialsProvider
} from "./services/credentials.js";
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
}

export async function createApp(options: CreateAppOptions = {}): Promise<CreatedApp> {
  const config = options.config ?? parseConfig();
  const catalog = options.catalog ?? (await OpenApiCatalog.load(config.churchToolsOpenApiUrl));
  const api = options.api ?? createChurchToolsApi(config);
  const mcpServer = createChurchToolsMcpServer({ config, api, catalog });

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "2mb" }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/ready", (_req, res) => {
    res.json({
      status: "ready",
      operations: catalog.operations.length
    });
  });

  app.post("/mcp", requireMcpAuth(config), async (req, res) => {
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

  return { app, config, catalog };
}

function createChurchToolsApi(config: AppConfig): ChurchToolsApi {
  if (config.churchToolsAuthMode === "pat-forwarding") {
    return new ChurchToolsApi(config, new ForwardedPatChurchToolsCredentialsProvider());
  }

  if (!config.churchToolsPat) {
    throw new Error("PAT mode requires CHURCHTOOLS_PAT.");
  }

  return new ChurchToolsApi(config, new StaticChurchToolsCredentialsProvider(config.churchToolsPat));
}
