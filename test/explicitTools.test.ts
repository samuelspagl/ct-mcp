import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { describe, expect, it, vi } from "vitest";
import { FORWARDED_CHURCHTOOLS_PAT_EXTRA_KEY } from "../src/services/credentials.js";
import { explicitToolDefinitions, runExplicitTool } from "../src/tools/explicitTools.js";
import type { ChurchToolsRequest } from "../src/types.js";
import { testConfig } from "./helpers.js";

function getTool(name: string) {
  const definition = explicitToolDefinitions.find((tool) => tool.name === name);
  if (!definition) {
    throw new Error(`Missing tool ${name}`);
  }
  return definition;
}

describe("explicit ChurchTools tools", () => {
  it("registers the requested first-pass ct_* tool surface without avoided tools", () => {
    expect(explicitToolDefinitions.map((tool) => tool.name)).toEqual([
      "ct_whoami",
      "ct_get_my_profile",
      "ct_search_people",
      "ct_get_person_profile",
      "ct_list_person_groups",
      "ct_search_groups",
      "ct_list_my_groups",
      "ct_list_my_led_groups",
      "ct_list_favorite_groups",
      "ct_get_group_context",
      "ct_get_group_members",
      "ct_list_events",
      "ct_list_my_events",
      "ct_list_person_events",
      "ct_get_event_briefing",
      "ct_get_my_event_briefing",
      "ct_list_calendar_appointments",
      "ct_list_my_calendar_appointments",
      "ct_list_my_absences",
      "ct_list_person_absences",
      "ct_list_group_absences",
      "ct_create_my_absence",
      "ct_create_person_absence",
      "ct_list_my_service_requests",
      "ct_list_person_service_requests",
      "ct_accept_my_service_request",
      "ct_decline_my_service_request",
      "ct_search_songs",
      "ct_get_song",
      "ct_list_event_songs",
      "ct_list_my_upcoming_event_songs",
      "ct_get_song_usage_report",
      "ct_wiki_search",
      "ct_wiki_get_page",
      "ct_get_person_masterdata",
      "ct_get_event_masterdata",
      "ct_get_group_masterdata"
    ]);

    expect(explicitToolDefinitions.some((tool) => tool.name.includes("finance"))).toBe(false);
    expect(explicitToolDefinitions.some((tool) => tool.name.includes("login_token"))).toBe(false);
    expect(explicitToolDefinitions.some((tool) => tool.name.includes("delete_person"))).toBe(false);
  });

  it("returns current user context from whoami", async () => {
    const api = {
      request: vi.fn(async () => ({
        data: {
          person: { id: 42, name: "Anna Example", email: "anna@example.test" },
          user: { id: 7 }
        }
      }))
    };

    const result = await runExplicitTool(getTool("ct_whoami"), api, { response_format: "json" }, testConfig);

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      personId: 42,
      userId: 7,
      name: "Anna Example",
      email: "anna@example.test"
    });
    expect(api.request).toHaveBeenCalledWith({
      method: "GET",
      path: "/whoami",
      query: { only_allow_authenticated: true }
    });
  });

  it("passes MCP auth context through ct_whoami requests", async () => {
    const api = {
      request: vi.fn(async () => ({
        data: {
          person: { id: 42, name: "Anna Example", email: "anna@example.test" },
          user: { id: 7 }
        }
      }))
    };
    const authInfo: AuthInfo = {
      token: "mcp-token",
      clientId: "pat-forwarding",
      scopes: ["churchtools"],
      extra: {
        [FORWARDED_CHURCHTOOLS_PAT_EXTRA_KEY]: "user-pat"
      }
    };

    const result = await runExplicitTool(
      getTool("ct_whoami"),
      api,
      { response_format: "json" },
      testConfig,
      undefined,
      { authInfo }
    );

    expect(result.isError).toBeUndefined();
    expect(api.request).toHaveBeenCalledWith(
      {
        method: "GET",
        path: "/whoami",
        query: { only_allow_authenticated: true }
      },
      { authInfo }
    );
  });

  it("does not create an absence unless dryRun is explicitly false", async () => {
    const api = {
      request: vi.fn(async (request: ChurchToolsRequest) => {
        if (request.path === "/whoami") {
          return { data: { person: { id: 42 } } };
        }
        return { data: {} };
      })
    };

    const result = await runExplicitTool(
      getTool("ct_create_my_absence"),
      api,
      { from: "2026-06-05", to: "2026-06-06", response_format: "json" },
      testConfig
    );

    expect(result.structuredContent).toMatchObject({
      dryRun: true,
      personId: 42
    });
    expect(api.request).toHaveBeenCalledTimes(1);
  });

  it("requires confirmation before executing dryRun=false writes", async () => {
    const api = {
      request: vi.fn(async (request: ChurchToolsRequest) => {
        if (request.path === "/whoami") {
          return { data: { person: { id: 42 } } };
        }
        return { data: {} };
      })
    };

    const result = await runExplicitTool(
      getTool("ct_create_my_absence"),
      api,
      { from: "2026-06-05", to: "2026-06-06", dryRun: false, response_format: "json" },
      testConfig
    );

    expect(result.structuredContent).toMatchObject({
      status: "confirmation_required",
      operation: "POST /persons/{personId}/absences",
      target: "person 42"
    });
    expect(api.request).toHaveBeenCalledTimes(1);
  });

  it("returns structured ambiguity errors from resolvers", async () => {
    const api = {
      request: vi.fn(async () => ({
        data: [
          { id: 1, name: "Anna Example", email: "anna.one@example.test" },
          { id: 2, name: "Anna Example", email: "anna.two@example.test" }
        ]
      }))
    };

    const result = await runExplicitTool(
      getTool("ct_get_person_profile"),
      api,
      { person: { name: "Anna" }, response_format: "json" },
      testConfig
    );

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      error: "AMBIGUOUS_PERSON"
    });
    expect(result.structuredContent?.candidates).toEqual([
      { id: 1, name: "Anna Example", email: "anna.one@example.test" },
      { id: 2, name: "Anna Example", email: "anna.two@example.test" }
    ]);
  });
});
