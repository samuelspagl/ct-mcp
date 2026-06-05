import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import { OpenApiCatalog } from "../src/services/openApiCatalog.js";
import { registerCatalogTools } from "../src/tools/catalogTools.js";
import { explicitToolDefinitions, registerExplicitTools } from "../src/tools/explicitTools.js";
import { registerReadTools } from "../src/tools/readTools.js";
import { registerWriteTools } from "../src/tools/writeTools.js";
import type { ChurchToolsRequest } from "../src/types.js";
import { testConfig } from "./helpers.js";

function collectToolNames(register: (server: McpServer) => void): string[] {
  const names: string[] = [];
  const server = {
    registerTool: vi.fn((name: string) => {
      names.push(name);
    })
  } as unknown as McpServer;

  register(server);
  return names;
}

describe("MCP tool registration", () => {
  it("exposes one ct_* namespace without churchtools_* duplicates", () => {
    const api = {
      request: vi.fn(async (_request: ChurchToolsRequest) => ({ data: {} }))
    };
    const catalog = OpenApiCatalog.fromDocument({
      openapi: "3.1.0",
      paths: {
        "/whoami": {
          get: {
            operationId: "get-whoami",
            summary: "Whoami"
          }
        },
        "/events/{eventId}": {
          put: {
            operationId: "update-event",
            summary: "Update event"
          }
        }
      }
    });

    const names = collectToolNames((server) => {
      const explicitNames = new Set(explicitToolDefinitions.map((definition) => definition.name));
      registerExplicitTools(server, api, testConfig);
      registerReadTools(server, api, testConfig, explicitNames);
      registerWriteTools(server, api, testConfig);
      registerCatalogTools(server, api, catalog, testConfig);
    });

    expect(names).toContain("ct_whoami");
    expect(names).toContain("ct_list_resources");
    expect(names).toContain("ct_list_my_involved_events");
    expect(names).toContain("ct_list_person_involved_events");
    expect(names).toContain("ct_get_my_involved_event_briefing");
    expect(names).toContain("ct_update_song");
    expect(names).toContain("ct_search_actions");
    expect(names).not.toContain("ct_list_my_events");
    expect(names).not.toContain("ct_list_person_events");
    expect(names).not.toContain("ct_get_my_event_briefing");
    expect(names).not.toContain("ct_list_my_calendar_appointments");
    expect(names).not.toContain("ct_list_my_upcoming_event_songs");
    expect(names.every((name) => name.startsWith("ct_"))).toBe(true);
    expect(names.filter((name) => name.startsWith("churchtools_"))).toEqual([]);
    expect(new Set(names).size).toBe(names.length);
  });
});
