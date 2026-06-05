import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { describe, expect, it, vi } from "vitest";
import { FORWARDED_CHURCHTOOLS_PAT_EXTRA_KEY } from "../src/services/credentials.js";
import { readToolDefinitions, runReadTool } from "../src/tools/readTools.js";
import type { ChurchToolsRequest } from "../src/types.js";
import { testConfig } from "./helpers.js";

const sampleParams: Record<string, Record<string, unknown>> = {
  ct_whoami: {},
  ct_list_persons: { page: 1, limit: 20 },
  ct_get_person: { personId: 1 },
  ct_list_person_groups: { personId: 1 },
  ct_list_person_involved_events: { personId: 1 },
  ct_list_groups: { page: 1, limit: 20 },
  ct_get_group: { groupId: 1 },
  ct_list_group_members: { groupId: 1, page: 1, limit: 20 },
  ct_list_events: { page: 1, limit: 20 },
  ct_get_event: { eventId: 1 },
  ct_get_event_agenda: { eventId: 1 },
  ct_list_calendars: {},
  ct_list_calendar_appointments: { calendar_ids: [1] },
  ct_list_resources: {},
  ct_list_bookings: { resource_ids: [1] },
  ct_get_booking: { bookingId: 1 },
  ct_search_songs: { page: 1, limit: 20 },
  ct_get_song: { songId: 1 },
  ct_search_wiki: { query: "policy" },
  ct_list_wiki_categories: {},
  ct_list_wiki_pages: { wikiCategoryId: 1 },
  ct_get_wiki_page: { wikiCategoryId: 1, identifier: "main" }
};

describe("read tools", () => {
  it("keeps the full dedicated read surface", () => {
    expect(readToolDefinitions.map((tool) => tool.name)).toEqual(Object.keys(sampleParams));
  });

  it("runs every dedicated read tool against the ChurchTools requester", async () => {
    const requests: ChurchToolsRequest[] = [];
    const api = {
      request: vi.fn(async (request: ChurchToolsRequest) => {
        requests.push(request);
        return { data: [] };
      })
    };

    for (const definition of readToolDefinitions) {
      const result = await runReadTool(definition, api, sampleParams[definition.name] ?? {}, testConfig);
      expect(result.isError).toBeUndefined();
    }

    expect(api.request).toHaveBeenCalledTimes(readToolDefinitions.length);
    expect(requests.map((request) => request.method).every((method) => method === "GET")).toBe(true);
    expect(requests.some((request) => request.path === "/calendars/appointments")).toBe(true);
    expect(requests.some((request) => request.path === "/bookings")).toBe(true);
  });

  it("passes MCP auth context to ChurchTools requester calls", async () => {
    const api = {
      request: vi.fn(async () => ({ data: {} }))
    };
    const authInfo: AuthInfo = {
      token: "mcp-token",
      clientId: "client",
      scopes: ["churchtools"],
      extra: {
        [FORWARDED_CHURCHTOOLS_PAT_EXTRA_KEY]: "user-pat"
      }
    };

    const result = await runReadTool(
      readToolDefinitions[0]!,
      api,
      sampleParams.ct_whoami ?? {},
      testConfig,
      { authInfo }
    );

    expect(result.isError).toBeUndefined();
    expect(api.request).toHaveBeenCalledWith(expect.any(Object), { authInfo });
  });
});
