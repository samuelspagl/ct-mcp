import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { z, type ZodRawShape } from "zod";
import type { AppConfig } from "../config.js";
import type { ChurchToolsRequest, ChurchToolsRequestContext, ChurchToolsRequester, QueryParams, ResponseFormat } from "../types.js";
import { compactQuery } from "../utils/object.js";
import { formatErrorResult, formatToolResult, type ToolResult } from "../utils/format.js";
import { requestChurchTools } from "../utils/apiRequest.js";
import {
  LimitSchema,
  OptionalIntArraySchema,
  OptionalStringArraySchema,
  PageSchema,
  ResponseFormatSchema
} from "./schemas.js";

export interface ReadToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: ZodRawShape;
  buildRequest: (params: Record<string, unknown>) => ChurchToolsRequest;
}

interface ToolRequestExtra {
  authInfo?: AuthInfo;
}

const responseFormatInput = {
  response_format: ResponseFormatSchema
};

const pageLimitInput = {
  page: PageSchema,
  limit: LimitSchema
};

export const readToolDefinitions: ReadToolDefinition[] = [
  {
    name: "ct_whoami",
    title: "ChurchTools Current User",
    description: "Return the ChurchTools user associated with the configured token.",
    inputSchema: {
      ...responseFormatInput
    },
    buildRequest: () => ({ method: "GET", path: "/whoami", query: { only_allow_authenticated: true } })
  },
  {
    name: "ct_list_persons",
    title: "ChurchTools Persons",
    description: "List persons with common filters such as IDs, status IDs, campus IDs, and pagination.",
    inputSchema: {
      ...pageLimitInput,
      ids: OptionalIntArraySchema.describe("Person IDs to include."),
      status_ids: OptionalIntArraySchema.describe("Status IDs to filter by."),
      campus_ids: OptionalIntArraySchema.describe("Campus IDs to filter by."),
      include: OptionalStringArraySchema.describe("Additional ChurchTools include fields."),
      is_archived: z.boolean().optional().describe("Whether to list archived persons."),
      ...responseFormatInput
    },
    buildRequest: (params) => ({
      method: "GET",
      path: "/persons",
      query: compactQuery({
        page: params.page as number,
        limit: params.limit as number,
        "ids[]": params.ids as number[] | undefined,
        "status_ids[]": params.status_ids as number[] | undefined,
        "campus_ids[]": params.campus_ids as number[] | undefined,
        include: params.include as string[] | undefined,
        is_archived: params.is_archived as boolean | undefined
      })
    })
  },
  {
    name: "ct_get_person",
    title: "ChurchTools Person",
    description: "Get one person by numeric ID or GUID.",
    inputSchema: {
      personId: z.union([z.number().int(), z.string()]).describe("Person ID or GUID."),
      include: OptionalStringArraySchema.describe("Additional ChurchTools include fields."),
      ...responseFormatInput
    },
    buildRequest: (params) => ({
      method: "GET",
      path: `/persons/${encodeURIComponent(String(params.personId))}`,
      query: compactQuery({ include: params.include as string[] | undefined })
    })
  },
  {
    name: "ct_list_person_groups",
    title: "ChurchTools Person Groups",
    description: "List all groups a person belongs to.",
    inputSchema: {
      personId: z.number().int().describe("Person ID."),
      ...responseFormatInput
    },
    buildRequest: (params) => ({ method: "GET", path: `/persons/${params.personId}/groups` })
  },
  {
    name: "ct_list_person_involved_events",
    title: "ChurchTools Person Involved Events",
    description: "List events from /persons/{personId}/events where ChurchTools marks a person as involved.",
    inputSchema: {
      personId: z.number().int().describe("Person ID."),
      ...responseFormatInput
    },
    buildRequest: (params) => ({ method: "GET", path: `/persons/${params.personId}/events` })
  },
  {
    name: "ct_list_groups",
    title: "ChurchTools Groups",
    description: "List groups with common filters and pagination.",
    inputSchema: {
      ...pageLimitInput,
      query: z.string().optional().describe("Text search query."),
      ids: OptionalIntArraySchema.describe("Group IDs to include."),
      campus_ids: OptionalIntArraySchema.describe("Campus IDs to filter by."),
      group_type_ids: OptionalIntArraySchema.describe("Group type IDs to filter by."),
      only_my_groups: z.boolean().optional().describe("Only return groups for the current user."),
      ...responseFormatInput
    },
    buildRequest: (params) => ({
      method: "GET",
      path: "/groups",
      query: compactQuery({
        page: params.page as number,
        limit: params.limit as number,
        query: params.query as string | undefined,
        "ids[]": params.ids as number[] | undefined,
        "campus_ids[]": params.campus_ids as number[] | undefined,
        "group_type_ids[]": params.group_type_ids as number[] | undefined,
        only_my_groups: params.only_my_groups as boolean | undefined
      })
    })
  },
  {
    name: "ct_get_group",
    title: "ChurchTools Group",
    description: "Get one group by ID.",
    inputSchema: {
      groupId: z.number().int().describe("Group ID."),
      ...responseFormatInput
    },
    buildRequest: (params) => ({ method: "GET", path: `/groups/${params.groupId}` })
  },
  {
    name: "ct_list_group_members",
    title: "ChurchTools Group Members",
    description: "List members of a ChurchTools group.",
    inputSchema: {
      groupId: z.number().int().describe("Group ID."),
      ...pageLimitInput,
      query: z.string().optional().describe("Text search query."),
      role_ids: OptionalIntArraySchema.describe("Role IDs to filter by."),
      person_id: OptionalIntArraySchema.describe("Person IDs to filter by."),
      include: OptionalStringArraySchema.describe("Additional ChurchTools include fields."),
      ...responseFormatInput
    },
    buildRequest: (params) => ({
      method: "GET",
      path: `/groups/${params.groupId}/members`,
      query: compactQuery({
        page: params.page as number,
        limit: params.limit as number,
        query: params.query as string | undefined,
        "role_ids[]": params.role_ids as number[] | undefined,
        "person_id[]": params.person_id as number[] | undefined,
        include: params.include as string[] | undefined
      })
    })
  },
  {
    name: "ct_list_events",
    title: "ChurchTools Events",
    description: "List events with date range, cancellation, direction, include, and pagination filters.",
    inputSchema: {
      ...pageLimitInput,
      from: z.string().optional().describe("Start date/time filter."),
      to: z.string().optional().describe("End date/time filter."),
      canceled: z.boolean().optional().describe("Whether to include canceled events."),
      direction: z.enum(["before", "after"]).optional().describe("ChurchTools direction filter."),
      include: z.string().optional().describe("ChurchTools include parameter."),
      ...responseFormatInput
    },
    buildRequest: (params) => ({
      method: "GET",
      path: "/events",
      query: compactQuery({
        page: params.page as number,
        limit: params.limit as number,
        from: params.from as string | undefined,
        to: params.to as string | undefined,
        canceled: params.canceled as boolean | undefined,
        direction: params.direction as string | undefined,
        include: params.include as string | undefined
      })
    })
  },
  {
    name: "ct_get_event",
    title: "ChurchTools Event",
    description: "Get one event by ID.",
    inputSchema: {
      eventId: z.number().int().describe("Event ID."),
      ...responseFormatInput
    },
    buildRequest: (params) => ({ method: "GET", path: `/events/${params.eventId}` })
  },
  {
    name: "ct_get_event_agenda",
    title: "ChurchTools Event Agenda",
    description: "Get the agenda for one event.",
    inputSchema: {
      eventId: z.number().int().describe("Event ID."),
      ...responseFormatInput
    },
    buildRequest: (params) => ({ method: "GET", path: `/events/${params.eventId}/agenda` })
  },
  {
    name: "ct_list_calendars",
    title: "ChurchTools Calendars",
    description: "List calendars visible to the current user.",
    inputSchema: responseFormatInput,
    buildRequest: () => ({ method: "GET", path: "/calendars" })
  },
  {
    name: "ct_list_calendar_appointments",
    title: "ChurchTools Calendar Appointments",
    description: "List appointments for one or more calendars.",
    inputSchema: {
      calendar_ids: z.array(z.number().int()).min(1).describe("Calendar IDs. ChurchTools requires at least one."),
      from: z.string().optional().describe("Start date/time filter."),
      to: z.string().optional().describe("End date/time filter."),
      query: z.string().optional().describe("Text search query."),
      include: OptionalStringArraySchema.describe("Additional ChurchTools include fields."),
      ...responseFormatInput
    },
    buildRequest: (params) => ({
      method: "GET",
      path: "/calendars/appointments",
      query: compactQuery({
        "calendar_ids[]": params.calendar_ids as number[],
        from: params.from as string | undefined,
        to: params.to as string | undefined,
        query: params.query as string | undefined,
        "include[]": params.include as string[] | undefined
      })
    })
  },
  {
    name: "ct_list_resources",
    title: "ChurchTools Resources",
    description: "List resources visible to the current user.",
    inputSchema: responseFormatInput,
    buildRequest: () => ({ method: "GET", path: "/resources" })
  },
  {
    name: "ct_list_bookings",
    title: "ChurchTools Bookings",
    description: "List bookings for one or more resources.",
    inputSchema: {
      resource_ids: z.array(z.number().int()).min(1).describe("Resource IDs. ChurchTools requires at least one."),
      from: z.string().optional().describe("Start date/time filter."),
      to: z.string().optional().describe("End date/time filter."),
      query: z.string().optional().describe("Text search query."),
      person_id: z.number().int().optional().describe("Person ID filter."),
      status_ids: OptionalIntArraySchema.describe("Booking status IDs."),
      include: OptionalStringArraySchema.describe("Additional ChurchTools include fields."),
      ...responseFormatInput
    },
    buildRequest: (params) => ({
      method: "GET",
      path: "/bookings",
      query: compactQuery({
        "resource_ids[]": params.resource_ids as number[],
        from: params.from as string | undefined,
        to: params.to as string | undefined,
        query: params.query as string | undefined,
        person_id: params.person_id as number | undefined,
        "status_ids[]": params.status_ids as number[] | undefined,
        "include[]": params.include as string[] | undefined
      })
    })
  },
  {
    name: "ct_get_booking",
    title: "ChurchTools Booking",
    description: "Get one booking by ID.",
    inputSchema: {
      bookingId: z.number().int().describe("Booking ID."),
      ...responseFormatInput
    },
    buildRequest: (params) => ({ method: "GET", path: `/bookings/${params.bookingId}` })
  },
  {
    name: "ct_search_songs",
    title: "ChurchTools Songs",
    description: "Search or list songs.",
    inputSchema: {
      ...pageLimitInput,
      query: z.string().optional().describe("Text search query."),
      name: z.string().optional().describe("Song name filter."),
      song_category_ids: OptionalIntArraySchema.describe("Song category IDs."),
      include: OptionalStringArraySchema.describe("Additional ChurchTools include fields."),
      practice: z.boolean().optional().describe("Practice filter."),
      ...responseFormatInput
    },
    buildRequest: (params) => ({
      method: "GET",
      path: "/songs",
      query: compactQuery({
        page: params.page as number,
        limit: params.limit as number,
        query: params.query as string | undefined,
        name: params.name as string | undefined,
        "song_category_ids[]": params.song_category_ids as number[] | undefined,
        include: params.include as string[] | undefined,
        practice: params.practice as boolean | undefined
      })
    })
  },
  {
    name: "ct_get_song",
    title: "ChurchTools Song",
    description: "Get one song by ID.",
    inputSchema: {
      songId: z.number().int().describe("Song ID."),
      ...responseFormatInput
    },
    buildRequest: (params) => ({ method: "GET", path: `/songs/${params.songId}` })
  },
  {
    name: "ct_search_wiki",
    title: "ChurchTools Wiki Search",
    description: "Search wiki pages.",
    inputSchema: {
      query: z.string().min(1).describe("Wiki search query."),
      wiki_category_ids: OptionalIntArraySchema.describe("Wiki category IDs."),
      ...responseFormatInput
    },
    buildRequest: (params) => ({
      method: "GET",
      path: "/wiki/search",
      query: compactQuery({
        query: params.query as string,
        "wiki_category_ids[]": params.wiki_category_ids as number[] | undefined
      })
    })
  },
  {
    name: "ct_list_wiki_categories",
    title: "ChurchTools Wiki Categories",
    description: "List wiki categories.",
    inputSchema: responseFormatInput,
    buildRequest: () => ({ method: "GET", path: "/wiki/categories" })
  },
  {
    name: "ct_list_wiki_pages",
    title: "ChurchTools Wiki Pages",
    description: "List wiki pages in a category.",
    inputSchema: {
      wikiCategoryId: z.number().int().describe("Wiki category ID."),
      ...responseFormatInput
    },
    buildRequest: (params) => ({ method: "GET", path: `/wiki/categories/${params.wikiCategoryId}/pages` })
  },
  {
    name: "ct_get_wiki_page",
    title: "ChurchTools Wiki Page",
    description: "Get the latest version of a wiki page by category ID and page identifier.",
    inputSchema: {
      wikiCategoryId: z.number().int().describe("Wiki category ID."),
      identifier: z.string().min(1).describe("Wiki page identifier."),
      ...responseFormatInput
    },
    buildRequest: (params) => ({
      method: "GET",
      path: `/wiki/categories/${params.wikiCategoryId}/pages/${encodeURIComponent(String(params.identifier))}`
    })
  }
];

export function registerReadTools(
  server: McpServer,
  api: ChurchToolsRequester,
  config: Pick<AppConfig, "maxResponseBytes">,
  skipNames: ReadonlySet<string> = new Set()
): void {
  for (const definition of readToolDefinitions) {
    if (skipNames.has(definition.name)) {
      continue;
    }

    server.registerTool(
      definition.name,
      {
        title: definition.title,
        description: definition.description,
        inputSchema: definition.inputSchema,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true
        }
      },
      async (params, extra: ToolRequestExtra) =>
        runReadTool(definition, api, params as Record<string, unknown>, config, toolContext(extra))
    );
  }
}

export async function runReadTool(
  definition: ReadToolDefinition,
  api: ChurchToolsRequester,
  params: Record<string, unknown>,
  config: Pick<AppConfig, "maxResponseBytes">,
  context: ChurchToolsRequestContext = {}
): Promise<ToolResult> {
  try {
    const data = await requestChurchTools(api, definition.buildRequest(params), context);
    return formatToolResult(data, {
      title: definition.title,
      responseFormat: params.response_format as ResponseFormat | undefined,
      config
    });
  } catch (error) {
    return formatErrorResult(error);
  }
}

function toolContext(extra: ToolRequestExtra): ChurchToolsRequestContext {
  return {
    authInfo: extra.authInfo
  };
}
