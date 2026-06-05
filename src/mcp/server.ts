import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppConfig } from "../config.js";
import { SERVER_NAME, SERVER_VERSION } from "../constants.js";
import type { ChurchToolsRequester } from "../types.js";
import { OpenApiCatalog } from "../services/openApiCatalog.js";
import { registerCatalogTools } from "../tools/catalogTools.js";
import { explicitToolDefinitions, registerExplicitTools } from "../tools/explicitTools.js";
import { registerReadTools } from "../tools/readTools.js";
import { registerWriteTools } from "../tools/writeTools.js";

export interface CreateMcpServerOptions {
  config: Pick<AppConfig, "maxResponseBytes">;
  api: ChurchToolsRequester;
  catalog: OpenApiCatalog;
}

export function createChurchToolsMcpServer(options: CreateMcpServerOptions): McpServer {
  const server = new McpServer(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION
    },
    {
      instructions:
        "Use ct_* ChurchTools tools for common person, group, event, calendar, resource, booking, song, and wiki workflows. Use ct_search_actions before generic execute tools for long-tail API operations. Write tools require confirmation."
    }
  );

  const explicitNames = new Set(explicitToolDefinitions.map((definition) => definition.name));
  registerExplicitTools(server, options.api, options.config);
  registerReadTools(server, options.api, options.config, explicitNames);
  registerWriteTools(server, options.api, options.config);
  registerCatalogTools(server, options.api, options.catalog, options.config);

  return server;
}
