import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { z, type ZodRawShape } from "zod";
import type { AppConfig } from "../config.js";
import type { ChurchToolsRequestContext, ChurchToolsRequester, QueryParams, ResponseFormat } from "../types.js";
import { compactBody, compactQuery } from "../utils/object.js";
import { formatToolResult, type ToolResult } from "../utils/format.js";
import { ConfirmationHost, requireWriteConfirmation } from "./confirmation.js";
import { ResponseFormatSchema } from "./schemas.js";

const DEFAULT_LIMIT = 25;
const DEFAULT_ENRICH_LIMIT = 50;
const DEFAULT_REPORT_LIMIT = 100;

const DateRangeInput = {
  from: z.string().optional().describe("ISO date or datetime, inclusive."),
  to: z.string().optional().describe("ISO date or datetime, inclusive.")
};

const PaginationInput = {
  page: z.number().int().positive().optional().describe("ChurchTools result page."),
  limit: z.number().int().positive().max(100).optional().describe("Maximum number of ChurchTools records to return.")
};

const PersonSelectorSchema = z
  .object({
    id: z.number().int().positive().optional(),
    guid: z.string().optional(),
    email: z.string().email().optional(),
    name: z.string().optional()
  })
  .refine((value) => value.id || value.guid || value.email || value.name, {
    message: "Provide at least one person selector: id, guid, email, or name."
  });

const GroupSelectorSchema = z
  .object({
    id: z.number().int().positive().optional(),
    name: z.string().optional()
  })
  .refine((value) => value.id || value.name, { message: "Provide id or name." });

const EventSelectorSchema = z
  .object({
    id: z.number().int().positive().optional(),
    title: z.string().optional(),
    date: z.string().optional()
  })
  .refine((value) => value.id || value.title, { message: "Provide id or title." });

type PersonSelector = z.infer<typeof PersonSelectorSchema>;
type GroupSelector = z.infer<typeof GroupSelectorSchema>;
type EventSelector = z.infer<typeof EventSelectorSchema>;

interface ExplicitToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: ZodRawShape;
  handler: (
    api: ChurchToolsRequester,
    params: Record<string, unknown>,
    config: Pick<AppConfig, "maxResponseBytes">,
    confirmationHost?: ConfirmationHost
  ) => Promise<ToolResult>;
}

interface ToolRequestExtra {
  authInfo?: AuthInfo;
}

class StructuredToolError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "StructuredToolError";
  }
}

const responseFormatInput = {
  response_format: ResponseFormatSchema
};

export const explicitToolDefinitions: ExplicitToolDefinition[] = [
  tool("ct_whoami", "ChurchTools Whoami", "Return the authenticated ChurchTools user/person context.", {
    ...responseFormatInput
  }, async (api, params, config) => {
    const current = await resolveCurrentPerson(api);
    return ok(
      {
        personId: current.personId,
        userId: current.userId,
        name: current.displayName,
        email: current.email,
        raw: current.raw
      },
      "ChurchTools Whoami",
      params,
      config
    );
  }),

  tool("ct_get_my_profile", "My ChurchTools Profile", "Return the current authenticated person's profile with clearly scoped optional enrichments.", {
    includeGroups: z.boolean().optional().describe("Include groups where the authenticated person is a member."),
    includeTags: z.boolean().optional().describe("Include tags assigned to the authenticated person."),
    includeRelationships: z.boolean().optional().describe("Include relationship records for the authenticated person."),
    includeInvolvedEvents: z
      .boolean()
      .optional()
      .describe("Include events from /persons/{personId}/events where ChurchTools marks the authenticated person as involved; this is not all visible events."),
    ...responseFormatInput
  }, async (api, params, config) => {
    const current = await resolveCurrentPerson(api);
    const person = await api.request({ method: "GET", path: `/persons/${current.personId}` });
    const data: Record<string, unknown> = { person: unwrapData(person) };
    await maybeAdd(data, "groups", params.includeGroups, () => api.request({ method: "GET", path: `/persons/${current.personId}/groups` }));
    await maybeAdd(data, "tags", params.includeTags, () => api.request({ method: "GET", path: `/persons/${current.personId}/tags` }));
    await maybeAdd(data, "relationships", params.includeRelationships, () =>
      api.request({ method: "GET", path: `/persons/${current.personId}/relationships` })
    );
    await maybeAdd(data, "involvedEvents", params.includeInvolvedEvents, () =>
      api.request({ method: "GET", path: `/persons/${current.personId}/events` })
    );
    return ok({ personId: current.personId, ...data }, "My ChurchTools Profile", params, config);
  }),

  tool("ct_search_people", "Search ChurchTools People", "Search all visible people.", {
    query: z.string().optional(),
    name: z.string().optional(),
    email: z.string().email().optional(),
    statusIds: z.array(z.number().int()).optional(),
    campusIds: z.array(z.number().int()).optional(),
    tagIds: z.array(z.number().int()).optional(),
    ...PaginationInput,
    ...responseFormatInput
  }, async (api, params, config) => {
    const response = await api.request({
      method: "GET",
      path: "/persons",
      query: personSearchQuery(params)
    });
    const people = narrowPeople(unwrapList(response), params);
    return ok({ people, pagination: getPaginationMeta(response) }, "Search ChurchTools People", params, config);
  }),

  tool("ct_get_person_profile", "ChurchTools Person Profile", "Return a composite profile for a specific person with clearly scoped optional enrichments.", {
    person: PersonSelectorSchema,
    includeGroups: z.boolean().optional().describe("Include groups where the selected person is a member."),
    includeTags: z.boolean().optional().describe("Include tags assigned to the selected person."),
    includeRelationships: z.boolean().optional().describe("Include relationship records for the selected person."),
    includeInvolvedEvents: z
      .boolean()
      .optional()
      .describe("Include events from /persons/{personId}/events where ChurchTools marks the selected person as involved; this is not all visible events."),
    includeAbsences: z.boolean().optional().describe("Include absences recorded for the selected person."),
    includeServiceRequests: z
      .boolean()
      .optional()
      .describe("Include service requests/tasks assigned to the selected person; these are separate from involved events."),
    ...responseFormatInput
  }, async (api, params, config) => {
    const resolved = await resolvePerson(api, params.person as PersonSelector);
    const profile = await api.request({ method: "GET", path: `/persons/${resolved.id}` });
    const data: Record<string, unknown> = { person: unwrapData(profile) };
    await maybeAdd(data, "groups", params.includeGroups, () => api.request({ method: "GET", path: `/persons/${resolved.id}/groups` }));
    await maybeAdd(data, "tags", params.includeTags, () => api.request({ method: "GET", path: `/persons/${resolved.id}/tags` }));
    await maybeAdd(data, "relationships", params.includeRelationships, () =>
      api.request({ method: "GET", path: `/persons/${resolved.id}/relationships` })
    );
    await maybeAdd(data, "involvedEvents", params.includeInvolvedEvents, () =>
      api.request({ method: "GET", path: `/persons/${resolved.id}/events` })
    );
    await maybeAdd(data, "absences", params.includeAbsences, () => api.request({ method: "GET", path: `/persons/${resolved.id}/absences` }));
    await maybeAdd(data, "serviceRequests", params.includeServiceRequests, () =>
      api.request({ method: "GET", path: `/persons/${resolved.id}/servicerequests` })
    );
    return ok({ personId: resolved.id, ...data }, "ChurchTools Person Profile", params, config);
  }),

  tool("ct_list_person_groups", "ChurchTools Person Groups", "List groups involving a specific person.", {
    person: PersonSelectorSchema,
    ...responseFormatInput
  }, async (api, params, config) => {
    const person = await resolvePerson(api, params.person as PersonSelector);
    const response = await api.request({ method: "GET", path: `/persons/${person.id}/groups` });
    return ok({ personId: person.id, groups: unwrapList(response) }, "ChurchTools Person Groups", params, config);
  }),

  tool("ct_search_groups", "Search ChurchTools Groups", "Search all visible groups.", {
    query: z.string().optional(),
    name: z.string().optional(),
    groupTypeIds: z.array(z.number().int()).optional(),
    campusIds: z.array(z.number().int()).optional(),
    status: z.string().optional(),
    ...PaginationInput,
    ...responseFormatInput
  }, async (api, params, config) => {
    const response = await api.request({
      method: "GET",
      path: "/groups",
      query: groupSearchQuery(params)
    });
    const groups = narrowByName(unwrapList(response), params.name as string | undefined);
    return ok({ groups, pagination: getPaginationMeta(response) }, "Search ChurchTools Groups", params, config);
  }),

  tool("ct_list_my_groups", "My ChurchTools Groups", "List groups where the authenticated user is a member.", {
    includeInactive: z.boolean().optional(),
    ...responseFormatInput
  }, async (api, params, config) => {
    const current = await resolveCurrentPerson(api);
    const response = await api.request({ method: "GET", path: `/persons/${current.personId}/groups` });
    const groups = maybeFilterInactive(unwrapList(response), params.includeInactive as boolean | undefined);
    return ok({ personId: current.personId, groups }, "My ChurchTools Groups", params, config);
  }),

  tool("ct_list_my_led_groups", "My Led ChurchTools Groups", "List groups where the authenticated user appears to have a leader role.", {
    includeInactive: z.boolean().optional(),
    ...responseFormatInput
  }, async (api, params, config) => {
    const current = await resolveCurrentPerson(api);
    const response = await api.request({ method: "GET", path: `/persons/${current.personId}/groups` });
    const groups = maybeFilterInactive(unwrapList(response), params.includeInactive as boolean | undefined);
    const ledGroups = groups.filter(looksLikeLeaderMembership);
    const warning =
      ledGroups.length === 0
        ? "Leader-role semantics could not be determined reliably from the returned membership fields; returning all groups."
        : undefined;
    return ok(
      { personId: current.personId, groups: ledGroups.length > 0 ? ledGroups : groups, warning },
      "My Led ChurchTools Groups",
      params,
      config
    );
  }),

  tool("ct_list_favorite_groups", "Favorite ChurchTools Groups", "List groups favorited by the current user, if the instance exposes a reliable endpoint.", {
    ...responseFormatInput
  }, async (_api, params, config) =>
    ok(
      {
        groups: [],
        supported: false,
        warning: "Favorite groups are not exposed through a reliable endpoint in this first-pass implementation."
      },
      "Favorite ChurchTools Groups",
      params,
      config
    )
  ),

  tool("ct_get_group_context", "ChurchTools Group Context", "Return a composite group view.", {
    group: GroupSelectorSchema,
    includeMembers: z.boolean().optional(),
    includeStatistics: z.boolean().optional(),
    includeTags: z.boolean().optional(),
    includePlaces: z.boolean().optional(),
    includeMeetings: z.boolean().optional(),
    includeMemberFields: z.boolean().optional(),
    includeAbsences: z.boolean().optional(),
    ...responseFormatInput
  }, async (api, params, config) => {
    const group = await resolveGroup(api, params.group as GroupSelector);
    const response = await api.request({ method: "GET", path: `/groups/${group.id}` });
    const data: Record<string, unknown> = { group: unwrapData(response) };
    await maybeAdd(data, "members", params.includeMembers, () => api.request({ method: "GET", path: `/groups/${group.id}/members` }));
    await maybeAdd(data, "statistics", params.includeStatistics, () => api.request({ method: "GET", path: `/groups/${group.id}/statistics` }));
    await maybeAdd(data, "tags", params.includeTags, () => api.request({ method: "GET", path: `/groups/${group.id}/tags` }));
    await maybeAdd(data, "places", params.includePlaces, () => api.request({ method: "GET", path: `/groups/${group.id}/places` }));
    await maybeAdd(data, "meetings", params.includeMeetings, () => api.request({ method: "GET", path: `/groups/${group.id}/meetings` }));
    await maybeAdd(data, "memberFields", params.includeMemberFields, () =>
      api.request({ method: "GET", path: `/groups/${group.id}/memberfields` })
    );
    await maybeAdd(data, "absences", params.includeAbsences, () => api.request({ method: "GET", path: `/groups/${group.id}/absences` }));
    return ok({ groupId: group.id, ...data }, "ChurchTools Group Context", params, config);
  }),

  tool("ct_get_group_members", "ChurchTools Group Members", "List members of a specific group.", {
    group: GroupSelectorSchema,
    includeInactive: z.boolean().optional(),
    ...PaginationInput,
    ...responseFormatInput
  }, async (api, params, config) => {
    const group = await resolveGroup(api, params.group as GroupSelector);
    const response = await api.request({
      method: "GET",
      path: `/groups/${group.id}/members`,
      query: paginationQuery(params)
    });
    const members = maybeFilterInactive(unwrapList(response), params.includeInactive as boolean | undefined);
    return ok({ groupId: group.id, members, pagination: getPaginationMeta(response) }, "ChurchTools Group Members", params, config);
  }),

  tool("ct_list_events", "ChurchTools Events", "List all visible ChurchTools events in a date range; this is not person-specific and does not imply user tasks.", {
    from: z.string(),
    to: z.string(),
    calendarIds: z.array(z.number().int()).optional().describe("Filter general visible events by calendar IDs."),
    serviceIds: z.array(z.number().int()).optional().describe("Filter general visible events by service IDs; this does not mean user assignments."),
    includeAgenda: z.boolean().optional().describe("Include the event agenda/order of service for each returned event."),
    includeSongs: z.boolean().optional().describe("Include songs from the event agenda for each returned event."),
    ...PaginationInput,
    ...responseFormatInput
  }, async (api, params, config) => {
    const response = await api.request({ method: "GET", path: "/events", query: eventListQuery(params) });
    const events = await enrichEvents(api, unwrapList(response), params);
    return ok({ events, pagination: getPaginationMeta(response) }, "ChurchTools Events", params, config);
  }),

  tool("ct_list_my_involved_events", "My Involved ChurchTools Events", "List events from /persons/{personId}/events where ChurchTools marks the authenticated user as involved; use service-request tools for concrete tasks.", {
    ...DateRangeInput,
    includeAgenda: z.boolean().optional().describe("Include the event agenda/order of service for each involved event."),
    includeSongs: z.boolean().optional().describe("Include songs from the event agenda for each involved event."),
    includeServiceRequests: z
      .boolean()
      .optional()
      .describe("Also include the authenticated user's service requests/tasks separately from the involved events."),
    ...PaginationInput,
    ...responseFormatInput
  }, async (api, params, config) => {
    const current = await resolveCurrentPerson(api);
    const data = await listPersonEvents(api, current.personId, params);
    return ok(data, "My Involved ChurchTools Events", params, config);
  }),

  tool("ct_list_person_involved_events", "ChurchTools Person Involved Events", "List events from /persons/{personId}/events where ChurchTools marks a specific person as involved; use service-request tools for concrete tasks.", {
    person: PersonSelectorSchema,
    ...DateRangeInput,
    includeAgenda: z.boolean().optional().describe("Include the event agenda/order of service for each involved event."),
    includeSongs: z.boolean().optional().describe("Include songs from the event agenda for each involved event."),
    includeServiceRequests: z
      .boolean()
      .optional()
      .describe("Also include the selected person's service requests/tasks separately from the involved events."),
    ...PaginationInput,
    ...responseFormatInput
  }, async (api, params, config) => {
    const person = await resolvePerson(api, params.person as PersonSelector);
    const data = await listPersonEvents(api, person.id, params);
    return ok(data, "ChurchTools Person Involved Events", params, config);
  }),

  tool("ct_get_event_briefing", "ChurchTools Event Briefing", "Return useful information for one event without checking whether any person is involved.", {
    event: EventSelectorSchema,
    includeAgenda: z.boolean().optional().describe("Include the event agenda/order of service."),
    includeSongs: z.boolean().optional().describe("Include songs from the event agenda."),
    includeFiles: z.boolean().optional().describe("Include files attached to the event."),
    ...responseFormatInput
  }, async (api, params, config) => {
    const event = await resolveEvent(api, params.event as EventSelector);
    const data = await getEventBriefing(api, event.id, params);
    return ok(data, "ChurchTools Event Briefing", params, config);
  }),

  tool("ct_get_my_involved_event_briefing", "My Involved ChurchTools Event Briefing", "Return one event briefing only if the event is listed in /persons/{personId}/events for the authenticated user.", {
    event: EventSelectorSchema,
    includeAgenda: z.boolean().optional().describe("Include the event agenda/order of service."),
    includeSongs: z.boolean().optional().describe("Include songs from the event agenda."),
    includeFiles: z.boolean().optional().describe("Include files attached to the event."),
    ...responseFormatInput
  }, async (api, params, config) => {
    const current = await resolveCurrentPerson(api);
    const event = await resolveEvent(api, params.event as EventSelector);
    await assertPersonInvolvedInEvent(api, current.personId, event.id);
    const data = await getEventBriefing(api, event.id, params);
    return ok({ personId: current.personId, ...data }, "My Involved ChurchTools Event Briefing", params, config);
  }),

  tool("ct_list_calendar_appointments", "ChurchTools Calendar Appointments", "List visible calendar appointments; this is calendar-scoped and not person-specific or task-specific.", {
    from: z.string(),
    to: z.string(),
    calendarIds: z.array(z.number().int()).optional().describe("Filter visible calendar appointments by calendar IDs."),
    includeEvent: z.boolean().optional().describe("Include the linked event object when ChurchTools exposes it."),
    ...PaginationInput,
    ...responseFormatInput
  }, async (api, params, config) => {
    const response = await api.request({
      method: "GET",
      path: "/calendars/appointments",
      query: compactQuery({
        from: params.from as string,
        to: params.to as string,
        "calendar_ids[]": params.calendarIds as number[] | undefined,
        include: params.includeEvent ? "event" : undefined,
        ...paginationQuery(params)
      })
    });
    return ok({ appointments: unwrapList(response), pagination: getPaginationMeta(response) }, "ChurchTools Calendar Appointments", params, config);
  }),

  tool("ct_list_my_absences", "My ChurchTools Absences", "List absences of the authenticated user.", {
    ...DateRangeInput,
    ...responseFormatInput
  }, async (api, params, config) => {
    const current = await resolveCurrentPerson(api);
    const response = await api.request({ method: "GET", path: `/persons/${current.personId}/absences`, query: dateRangeQuery(params) });
    return ok({ personId: current.personId, absences: unwrapList(response) }, "My ChurchTools Absences", params, config);
  }),

  tool("ct_list_person_absences", "ChurchTools Person Absences", "List absences for a specific person.", {
    person: PersonSelectorSchema,
    ...DateRangeInput,
    ...responseFormatInput
  }, async (api, params, config) => {
    const person = await resolvePerson(api, params.person as PersonSelector);
    const response = await api.request({ method: "GET", path: `/persons/${person.id}/absences`, query: dateRangeQuery(params) });
    return ok({ personId: person.id, absences: unwrapList(response) }, "ChurchTools Person Absences", params, config);
  }),

  tool("ct_list_group_absences", "ChurchTools Group Absences", "List absences for members of a specific group.", {
    group: GroupSelectorSchema,
    ...DateRangeInput,
    ...responseFormatInput
  }, async (api, params, config) => {
    const group = await resolveGroup(api, params.group as GroupSelector);
    const response = await api.request({ method: "GET", path: `/groups/${group.id}/absences`, query: dateRangeQuery(params) });
    return ok({ groupId: group.id, absences: unwrapList(response) }, "ChurchTools Group Absences", params, config);
  }),

  tool("ct_create_my_absence", "Create My ChurchTools Absence", "Create an absence for the authenticated user; dry-run by default.", {
    from: z.string(),
    to: z.string(),
    reasonId: z.number().int().optional(),
    comment: z.string().optional(),
    dryRun: z.boolean().default(true),
    confirm: z.boolean().optional(),
    ...responseFormatInput
  }, async (api, params, config, confirmationHost) => {
    const current = await resolveCurrentPerson(api);
    const payload = absencePayload(params);
    if (params.dryRun !== false) {
      return ok({ dryRun: true, message: "No changes were made. Re-run with dryRun=false to create the absence.", personId: current.personId, payload }, "Create My ChurchTools Absence", params, config);
    }
    const confirmation = await requireWriteConfirmation(confirmationHost, {
      confirm: params.confirm as boolean | undefined,
      operation: "POST /persons/{personId}/absences",
      target: `person ${current.personId}`,
      preview: payload
    });
    if (!confirmation.confirmed) {
      return confirmation.result;
    }
    const response = await api.request({ method: "POST", path: `/persons/${current.personId}/absences`, body: payload });
    return ok({ dryRun: false, personId: current.personId, absence: unwrapData(response) }, "Create My ChurchTools Absence", params, config);
  }),

  tool("ct_create_person_absence", "Create ChurchTools Person Absence", "Create an absence for a specific person; dry-run by default.", {
    person: PersonSelectorSchema,
    from: z.string(),
    to: z.string(),
    reasonId: z.number().int().optional(),
    comment: z.string().optional(),
    dryRun: z.boolean().default(true),
    confirm: z.boolean().optional(),
    ...responseFormatInput
  }, async (api, params, config, confirmationHost) => {
    const person = await resolvePerson(api, params.person as PersonSelector);
    const payload = absencePayload(params);
    if (params.dryRun !== false) {
      return ok({ dryRun: true, message: "No changes were made. Re-run with dryRun=false to create the absence.", personId: person.id, payload }, "Create ChurchTools Person Absence", params, config);
    }
    const confirmation = await requireWriteConfirmation(confirmationHost, {
      confirm: params.confirm as boolean | undefined,
      operation: "POST /persons/{personId}/absences",
      target: `person ${person.id}`,
      preview: payload
    });
    if (!confirmation.confirmed) {
      return confirmation.result;
    }
    const response = await api.request({ method: "POST", path: `/persons/${person.id}/absences`, body: payload });
    return ok({ dryRun: false, personId: person.id, absence: unwrapData(response) }, "Create ChurchTools Person Absence", params, config);
  }),

  tool("ct_list_my_service_requests", "My ChurchTools Service Requests", "List concrete service requests/tasks assigned to the authenticated user; these are separate from involved events.", {
    includePast: z.boolean().optional().describe("Include past service requests/tasks."),
    includeAnswered: z.boolean().optional().describe("Include service requests/tasks that were already accepted or declined."),
    ...responseFormatInput
  }, async (api, params, config) => {
    const current = await resolveCurrentPerson(api);
    const response = await api.request({ method: "GET", path: `/persons/${current.personId}/servicerequests`, query: serviceRequestQuery(params) });
    return ok({ personId: current.personId, serviceRequests: unwrapList(response) }, "My ChurchTools Service Requests", params, config);
  }),

  tool("ct_list_person_service_requests", "ChurchTools Person Service Requests", "List concrete service requests/tasks assigned to a specific person; these are separate from involved events.", {
    person: PersonSelectorSchema,
    includePast: z.boolean().optional().describe("Include past service requests/tasks."),
    includeAnswered: z.boolean().optional().describe("Include service requests/tasks that were already accepted or declined."),
    ...responseFormatInput
  }, async (api, params, config) => {
    const person = await resolvePerson(api, params.person as PersonSelector);
    const response = await api.request({ method: "GET", path: `/persons/${person.id}/servicerequests`, query: serviceRequestQuery(params) });
    return ok({ personId: person.id, serviceRequests: unwrapList(response) }, "ChurchTools Person Service Requests", params, config);
  }),

  tool("ct_accept_my_service_request", "Accept My ChurchTools Service Request", "Accept one service request for the authenticated user; dry-run by default.", {
    requestId: z.number().int().positive(),
    dryRun: z.boolean().default(true),
    confirm: z.boolean().optional(),
    ...responseFormatInput
  }, async (api, params, config, confirmationHost) => {
    const current = await resolveCurrentPerson(api);
    const path = `/persons/${current.personId}/servicerequests/${params.requestId}`;
    if (params.dryRun !== false) {
      return ok({ dryRun: true, personId: current.personId, method: "PUT", path, payload: {} }, "Accept My ChurchTools Service Request", params, config);
    }
    const confirmation = await requireWriteConfirmation(confirmationHost, {
      confirm: params.confirm as boolean | undefined,
      operation: "PUT /persons/{personId}/servicerequests/{requestId}",
      target: `service request ${params.requestId}`,
      preview: { personId: current.personId, payload: {} }
    });
    if (!confirmation.confirmed) {
      return confirmation.result;
    }
    const response = await api.request({ method: "PUT", path, body: {} });
    return ok({ dryRun: false, personId: current.personId, serviceRequest: unwrapData(response) }, "Accept My ChurchTools Service Request", params, config);
  }),

  tool("ct_decline_my_service_request", "Decline My ChurchTools Service Request", "Decline one service request for the authenticated user; dry-run by default.", {
    requestId: z.number().int().positive(),
    comment: z.string().optional(),
    dryRun: z.boolean().default(true),
    confirm: z.boolean().optional(),
    ...responseFormatInput
  }, async (api, params, config, confirmationHost) => {
    const current = await resolveCurrentPerson(api);
    const path = `/persons/${current.personId}/servicerequests/${params.requestId}`;
    const payload = compactBody({ comment: params.comment });
    if (params.dryRun !== false) {
      return ok({ dryRun: true, personId: current.personId, method: "DELETE", path, payload }, "Decline My ChurchTools Service Request", params, config);
    }
    const confirmation = await requireWriteConfirmation(confirmationHost, {
      confirm: params.confirm as boolean | undefined,
      operation: "DELETE /persons/{personId}/servicerequests/{requestId}",
      target: `service request ${params.requestId}`,
      preview: { personId: current.personId, payload }
    });
    if (!confirmation.confirmed) {
      return confirmation.result;
    }
    const response = await api.request({ method: "DELETE", path, body: payload });
    return ok({ dryRun: false, personId: current.personId, serviceRequest: unwrapData(response) }, "Decline My ChurchTools Service Request", params, config);
  }),

  tool("ct_search_songs", "Search ChurchTools Songs", "Search the visible song database.", {
    query: z.string().optional(),
    title: z.string().optional(),
    author: z.string().optional(),
    ...PaginationInput,
    ...responseFormatInput
  }, async (api, params, config) => {
    const response = await api.request({
      method: "GET",
      path: "/songs",
      query: compactQuery({
        page: params.page as number | undefined,
        limit: (params.limit as number | undefined) ?? DEFAULT_LIMIT,
        query: (params.query as string | undefined) ?? (params.title as string | undefined),
        author: params.author as string | undefined
      })
    });
    return ok({ songs: unwrapList(response), pagination: getPaginationMeta(response) }, "Search ChurchTools Songs", params, config);
  }),

  tool("ct_get_song", "ChurchTools Song", "Get one song by ID.", {
    songId: z.number().int().positive(),
    ...responseFormatInput
  }, async (api, params, config) => {
    const response = await api.request({ method: "GET", path: `/songs/${params.songId}` });
    return ok({ song: unwrapData(response) }, "ChurchTools Song", params, config);
  }),

  tool("ct_list_event_songs", "ChurchTools Event Songs", "List songs used in the agenda of a specific event; no person involvement is checked.", {
    event: EventSelectorSchema,
    ...responseFormatInput
  }, async (api, params, config) => {
    const event = await resolveEvent(api, params.event as EventSelector);
    const response = await api.request({ method: "GET", path: `/events/${event.id}/agenda/songs` });
    return ok({ eventId: event.id, songs: unwrapList(response) }, "ChurchTools Event Songs", params, config);
  }),

  tool("ct_list_my_involved_upcoming_event_songs", "My Involved Upcoming ChurchTools Event Songs", "List songs from upcoming events returned by /persons/{personId}/events for the authenticated user.", {
    from: z.string().optional(),
    to: z.string().optional(),
    limitEvents: z.number().int().positive().max(100).optional().describe("Maximum involved events to inspect for agenda songs."),
    ...responseFormatInput
  }, async (api, params, config) => {
    const dateRange = defaultUpcomingRange(params);
    const current = await resolveCurrentPerson(api);
    const eventData = await listPersonEvents(api, current.personId, dateRange);
    const events = unwrapEventItems(eventData.involvedEvents).slice(0, (params.limitEvents as number | undefined) ?? DEFAULT_ENRICH_LIMIT);
    const withSongs = await Promise.all(
      events.map(async (event) => ({
        event,
        songs: unwrapList(await api.request({ method: "GET", path: `/events/${idOf(event)}/agenda/songs` }))
      }))
    );
    return ok({ personId: current.personId, involvedEvents: withSongs }, "My Involved Upcoming ChurchTools Event Songs", params, config);
  }),

  tool("ct_get_song_usage_report", "ChurchTools Song Usage Report", "Create a simple usage report of songs over a date range.", {
    from: z.string(),
    to: z.string(),
    groupBy: z.enum(["song", "event"]).optional(),
    limitEvents: z.number().int().positive().max(250).optional().describe("Maximum general visible events to inspect for agenda songs."),
    ...responseFormatInput
  }, async (api, params, config) => {
    const response = await api.request({ method: "GET", path: "/events", query: eventListQuery(params) });
    const events = unwrapList(response).slice(0, (params.limitEvents as number | undefined) ?? DEFAULT_REPORT_LIMIT);
    const report = new Map<string, { songId?: number; title?: string; usageCount: number; events: unknown[] }>();
    for (const event of events) {
      const eventId = idOf(event);
      if (!eventId) {
        continue;
      }
      const songResponse = await api.request({ method: "GET", path: `/events/${eventId}/agenda/songs` });
      for (const song of unwrapList(songResponse)) {
        const songId = idOf(song);
        const title = stringField(song, ["title", "name"]);
        const key = songId ? String(songId) : title || JSON.stringify(song);
        const current = report.get(key) ?? { songId, title, usageCount: 0, events: [] };
        current.usageCount += 1;
        current.events.push(event);
        report.set(key, current);
      }
    }
    return ok({ from: params.from, to: params.to, songs: Array.from(report.values()) }, "ChurchTools Song Usage Report", params, config);
  }),

  tool("ct_wiki_search", "ChurchTools Wiki Search", "Search visible wiki pages.", {
    query: z.string(),
    ...PaginationInput,
    ...responseFormatInput
  }, async (api, params, config) => {
    const response = await api.request({
      method: "GET",
      path: "/wiki/search",
      query: compactQuery({ query: params.query as string, ...paginationQuery(params) })
    });
    return ok({ pages: unwrapList(response), pagination: getPaginationMeta(response) }, "ChurchTools Wiki Search", params, config);
  }),

  tool("ct_wiki_get_page", "ChurchTools Wiki Page", "Read one wiki page.", {
    categoryId: z.number().int().positive(),
    identifier: z.string().min(1),
    ...responseFormatInput
  }, async (api, params, config) => {
    const response = await api.request({
      method: "GET",
      path: `/wiki/categories/${params.categoryId}/pages/${encodeURIComponent(String(params.identifier))}`
    });
    return ok({ page: unwrapData(response) }, "ChurchTools Wiki Page", params, config);
  }),

  tool("ct_get_person_masterdata", "ChurchTools Person Masterdata", "Fetch person-related masterdata.", {
    ...responseFormatInput
  }, async (api, params, config) => {
    const masterdata = await requestFirstAvailable(api, ["/person/masterdata", "/masterdata/person"]);
    return ok({ masterdata }, "ChurchTools Person Masterdata", params, config);
  }),

  tool("ct_get_event_masterdata", "ChurchTools Event Masterdata", "Fetch event/service/song-related masterdata.", {
    ...responseFormatInput
  }, async (api, params, config) => {
    const masterdata = await requestFirstAvailable(api, ["/event/masterdata"]);
    return ok({ masterdata }, "ChurchTools Event Masterdata", params, config);
  }),

  tool("ct_get_group_masterdata", "ChurchTools Group Masterdata", "Fetch group-related masterdata.", {
    ...responseFormatInput
  }, async (api, params, config) => {
    try {
      const masterdata = await requestFirstAvailable(api, ["/group/masterdata", "/masterdata/group"]);
      return ok({ masterdata }, "ChurchTools Group Masterdata", params, config);
    } catch (error) {
      return ok(
        {
          masterdata: null,
          warning: error instanceof Error ? error.message : "Group masterdata could not be fetched."
        },
        "ChurchTools Group Masterdata",
        params,
        config
      );
    }
  })
];

export function registerExplicitTools(
  server: McpServer,
  api: ChurchToolsRequester,
  config: Pick<AppConfig, "maxResponseBytes">
): void {
  const confirmationHost = () => server as unknown as ConfirmationHost;

  for (const definition of explicitToolDefinitions) {
    server.registerTool(
      definition.name,
      {
        title: definition.title,
        description: definition.description,
        inputSchema: definition.inputSchema,
        annotations: {
          readOnlyHint: !definition.name.includes("_create_") && !definition.name.includes("_accept_") && !definition.name.includes("_decline_"),
          destructiveHint: definition.name.includes("_decline_"),
          idempotentHint: false,
          openWorldHint: true
        }
      },
      async (params, extra: ToolRequestExtra) =>
        runExplicitTool(definition, api, params as Record<string, unknown>, config, confirmationHost(), toolContext(extra))
    );
  }
}

export async function runExplicitTool(
  definition: ExplicitToolDefinition,
  api: ChurchToolsRequester,
  params: Record<string, unknown>,
  config: Pick<AppConfig, "maxResponseBytes">,
  confirmationHost?: ConfirmationHost,
  context: ChurchToolsRequestContext = {}
): Promise<ToolResult> {
  try {
    return await definition.handler(withRequestContext(api, context), params, config, confirmationHost);
  } catch (error) {
    return explicitErrorResult(error);
  }
}

function toolContext(extra: ToolRequestExtra): ChurchToolsRequestContext {
  return {
    authInfo: extra.authInfo
  };
}

function withRequestContext(api: ChurchToolsRequester, context: ChurchToolsRequestContext): ChurchToolsRequester {
  if (!context.authInfo) {
    return api;
  }

  return {
    request: (request, requestContext = {}) => api.request(request, requestContext.authInfo ? requestContext : context)
  };
}

function tool(
  name: string,
  title: string,
  description: string,
  inputSchema: ZodRawShape,
  handler: ExplicitToolDefinition["handler"]
): ExplicitToolDefinition {
  return { name, title, description, inputSchema, handler };
}

function ok(data: unknown, title: string, params: Record<string, unknown>, config: Pick<AppConfig, "maxResponseBytes">): ToolResult {
  return formatToolResult(data, {
    title,
    responseFormat: params.response_format as ResponseFormat | undefined,
    config
  });
}

function explicitErrorResult(error: unknown): ToolResult {
  if (error instanceof StructuredToolError) {
    const structuredContent = {
      error: error.code,
      message: error.message,
      ...error.details
    };
    return {
      isError: true,
      content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
      structuredContent
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  const structuredContent = { error: "CHURCHTOOLS_TOOL_ERROR", message };
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent
  };
}

async function resolveCurrentPerson(api: ChurchToolsRequester): Promise<{
  personId: number;
  userId?: number;
  email?: string;
  displayName?: string;
  raw: unknown;
}> {
  const raw = await api.request({ method: "GET", path: "/whoami", query: { only_allow_authenticated: true } });
  const data = unwrapRecord(raw);
  const person = objectField(data, ["person", "data"]);
  const user = objectField(data, ["user"]);
  const personId =
    numberField(data, ["personId", "person_id"]) ??
    numberField(person, ["id", "personId", "person_id"]) ??
    numberField(user, ["personId", "person_id"]) ??
    numberField(data, ["id"]);

  if (!personId) {
    throw new StructuredToolError("CURRENT_PERSON_NOT_FOUND", "Could not determine the current ChurchTools person ID from /whoami.", { raw });
  }

  return {
    personId,
    userId: numberField(data, ["userId", "user_id", "cmsUserId", "cms_user_id"]) ?? numberField(user, ["id", "userId", "user_id"]),
    email: stringField(data, ["email"]) ?? stringField(person, ["email"]) ?? stringField(user, ["email"]),
    displayName:
      stringField(data, ["name", "displayName"]) ??
      stringField(person, ["name", "displayName"]) ??
      stringField(user, ["name", "displayName"]) ??
      joinedName(data),
    raw
  };
}

async function resolvePerson(api: ChurchToolsRequester, selector: PersonSelector): Promise<{ id: number; raw?: unknown }> {
  if (selector.id) {
    return { id: selector.id };
  }

  const response = await api.request({ method: "GET", path: "/persons", query: personSearchQuery(selector) });
  const matches = narrowPeople(unwrapList(response), selector);
  const selected = selectSingle("PERSON", matches, selector);
  return { id: selected.id, raw: selected.raw };
}

async function resolveGroup(api: ChurchToolsRequester, selector: GroupSelector): Promise<{ id: number; raw?: unknown }> {
  if (selector.id) {
    return { id: selector.id };
  }

  const response = await api.request({
    method: "GET",
    path: "/groups",
    query: groupSearchQuery({ name: selector.name, limit: 10 })
  });
  const matches = narrowByName(unwrapList(response), selector.name).map(candidateFromUnknown);
  const selected = selectSingle("GROUP", matches, selector);
  return { id: selected.id, raw: selected.raw };
}

async function resolveEvent(api: ChurchToolsRequester, selector: EventSelector): Promise<{ id: number; raw?: unknown }> {
  if (selector.id) {
    return { id: selector.id };
  }

  const response = await api.request({
    method: "GET",
    path: "/events",
    query: compactQuery({
      query: selector.title,
      from: selector.date,
      to: selector.date,
      limit: 10
    })
  });
  const matches = narrowByName(unwrapList(response), selector.title, ["name", "title", "caption"]).map(candidateFromUnknown);
  const selected = selectSingle("EVENT", matches, selector);
  return { id: selected.id, raw: selected.raw };
}

async function listPersonEvents(api: ChurchToolsRequester, personId: number, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await api.request({
    method: "GET",
    path: `/persons/${personId}/events`,
    query: compactQuery({ ...dateRangeQuery(params), ...paginationQuery(params) })
  });
  const involvedEvents = await enrichEvents(api, filterByDate(unwrapList(response), params), params);
  const data: Record<string, unknown> = {
    personId,
    involvedEvents,
    pagination: getPaginationMeta(response)
  };
  if (params.includeServiceRequests) {
    data.serviceRequests = unwrapList(await api.request({ method: "GET", path: `/persons/${personId}/servicerequests` }));
  }
  return data;
}

async function assertPersonInvolvedInEvent(api: ChurchToolsRequester, personId: number, eventId: number): Promise<void> {
  const response = await api.request({
    method: "GET",
    path: `/persons/${personId}/events`,
    query: { limit: DEFAULT_REPORT_LIMIT }
  });
  const involvedEvents = unwrapList(response);
  if (involvedEvents.some((event) => idOf(event) === eventId)) {
    return;
  }

  throw new StructuredToolError(
    "EVENT_NOT_INVOLVED",
    "The selected event is not listed in /persons/{personId}/events for the authenticated user.",
    {
      personId,
      eventId
    }
  );
}

async function getEventBriefing(api: ChurchToolsRequester, eventId: number, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const event = await api.request({ method: "GET", path: `/events/${eventId}` });
  const data: Record<string, unknown> = {
    eventId,
    event: unwrapData(event)
  };
  await maybeAdd(data, "agenda", params.includeAgenda, () => api.request({ method: "GET", path: `/events/${eventId}/agenda` }));
  await maybeAdd(data, "songs", params.includeSongs, () => api.request({ method: "GET", path: `/events/${eventId}/agenda/songs` }));
  await maybeAdd(data, "files", params.includeFiles, () => api.request({ method: "GET", path: `/events/${eventId}/files` }));
  return data;
}

async function enrichEvents(api: ChurchToolsRequester, events: unknown[], params: Record<string, unknown>): Promise<unknown[]> {
  const shouldEnrich = params.includeAgenda || params.includeSongs;
  if (!shouldEnrich) {
    return events;
  }

  return Promise.all(
    events.slice(0, DEFAULT_ENRICH_LIMIT).map(async (event) => {
      const eventId = idOf(event);
      if (!eventId) {
        return event;
      }
      const data: Record<string, unknown> = { event };
      await maybeAdd(data, "agenda", params.includeAgenda, () => api.request({ method: "GET", path: `/events/${eventId}/agenda` }));
      await maybeAdd(data, "songs", params.includeSongs, () => api.request({ method: "GET", path: `/events/${eventId}/agenda/songs` }));
      return data;
    })
  );
}

async function maybeAdd(
  target: Record<string, unknown>,
  key: string,
  enabled: unknown,
  load: () => Promise<unknown>
): Promise<void> {
  if (!enabled) {
    return;
  }
  target[key] = unwrapData(await load());
}

async function requestFirstAvailable(api: ChurchToolsRequester, paths: string[]): Promise<unknown> {
  const errors: string[] = [];
  for (const path of paths) {
    try {
      return unwrapData(await api.request({ method: "GET", path }));
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new StructuredToolError("UNSUPPORTED_BY_INSTANCE", "No supported masterdata endpoint could be fetched.", { errors });
}

function personSearchQuery(params: Record<string, unknown>): QueryParams {
  return compactQuery({
    page: params.page as number | undefined,
    limit: (params.limit as number | undefined) ?? DEFAULT_LIMIT,
    query: (params.query as string | undefined) ?? (params.name as string | undefined) ?? (params.email as string | undefined),
    email: params.email as string | undefined,
    guid: params.guid as string | undefined,
    "ids[]": params.id ? [params.id as number] : undefined,
    "status_ids[]": params.statusIds as number[] | undefined,
    "campus_ids[]": params.campusIds as number[] | undefined,
    "tag_ids[]": params.tagIds as number[] | undefined
  });
}

function groupSearchQuery(params: Record<string, unknown>): QueryParams {
  return compactQuery({
    page: params.page as number | undefined,
    limit: (params.limit as number | undefined) ?? DEFAULT_LIMIT,
    query: (params.query as string | undefined) ?? (params.name as string | undefined),
    "group_type_ids[]": params.groupTypeIds as number[] | undefined,
    "campus_ids[]": params.campusIds as number[] | undefined,
    status: params.status as string | undefined
  });
}

function eventListQuery(params: Record<string, unknown>): QueryParams {
  return compactQuery({
    from: params.from as string | undefined,
    to: params.to as string | undefined,
    page: params.page as number | undefined,
    limit: (params.limit as number | undefined) ?? DEFAULT_LIMIT,
    "calendar_ids[]": params.calendarIds as number[] | undefined,
    "service_ids[]": params.serviceIds as number[] | undefined
  });
}

function paginationQuery(params: Record<string, unknown>): QueryParams {
  return compactQuery({
    page: params.page as number | undefined,
    limit: (params.limit as number | undefined) ?? DEFAULT_LIMIT
  });
}

function dateRangeQuery(params: Record<string, unknown>): QueryParams {
  return compactQuery({
    from: params.from as string | undefined,
    to: params.to as string | undefined
  });
}

function serviceRequestQuery(params: Record<string, unknown>): QueryParams {
  return compactQuery({
    includePast: params.includePast as boolean | undefined,
    includeAnswered: params.includeAnswered as boolean | undefined
  });
}

function absencePayload(params: Record<string, unknown>): Record<string, unknown> {
  return compactBody({
    from: params.from,
    to: params.to,
    reasonId: params.reasonId,
    comment: params.comment
  });
}

function defaultUpcomingRange(params: Record<string, unknown>): Record<string, unknown> {
  if (params.from && params.to) {
    return params;
  }
  const from = new Date();
  const to = new Date(from);
  to.setUTCDate(to.getUTCDate() + 60);
  return {
    ...params,
    from: params.from ?? from.toISOString().slice(0, 10),
    to: params.to ?? to.toISOString().slice(0, 10)
  };
}

function unwrapData(value: unknown): unknown {
  const object = asRecord(value);
  if (object && "data" in object) {
    return object.data;
  }
  return value;
}

function unwrapRecord(value: unknown): Record<string, unknown> {
  return asRecord(unwrapData(value)) ?? {};
}

function unwrapList(value: unknown): unknown[] {
  const unwrapped = unwrapData(value);
  if (Array.isArray(unwrapped)) {
    return unwrapped;
  }
  const object = asRecord(unwrapped);
  if (object && Array.isArray(object.data)) {
    return object.data;
  }
  return [];
}

function getPaginationMeta(value: unknown): unknown {
  const object = asRecord(value);
  const meta = asRecord(object?.meta);
  return meta?.pagination;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function objectField(object: Record<string, unknown> | undefined, keys: string[]): Record<string, unknown> | undefined {
  for (const key of keys) {
    const value = asRecord(object?.[key]);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function numberField(object: Record<string, unknown> | undefined, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = object?.[key];
    if (typeof value === "number") {
      return value;
    }
    if (typeof value === "string" && /^\d+$/.test(value)) {
      return Number(value);
    }
  }
  return undefined;
}

function stringField(value: unknown, keys: string[]): string | undefined {
  const object = asRecord(value);
  for (const key of keys) {
    const candidate = object?.[key];
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }
  return undefined;
}

function joinedName(value: unknown): string | undefined {
  const firstName = stringField(value, ["firstName", "first_name"]);
  const lastName = stringField(value, ["lastName", "last_name"]);
  const name = [firstName, lastName].filter(Boolean).join(" ").trim();
  return name.length > 0 ? name : undefined;
}

function idOf(value: unknown): number | undefined {
  return numberField(asRecord(value), ["id", "eventId", "songId", "personId", "groupId"]);
}

function candidateFromUnknown(value: unknown): { id: number; name?: string; email?: string; raw: unknown } {
  return {
    id: idOf(value) ?? 0,
    name: stringField(value, ["name", "title", "displayName", "caption"]),
    email: stringField(value, ["email"]),
    raw: value
  };
}

function selectSingle(
  kind: "PERSON" | "GROUP" | "EVENT",
  candidates: Array<{ id: number; name?: string; email?: string; raw: unknown }>,
  selector: unknown
): { id: number; raw: unknown } {
  const viable = candidates.filter((candidate) => candidate.id > 0);
  if (viable.length === 0) {
    throw new StructuredToolError(`${kind}_NOT_FOUND`, `No ${kind.toLowerCase()} matched the selector.`, { selector });
  }
  if (viable.length > 1) {
    throw new StructuredToolError(`AMBIGUOUS_${kind}`, `Multiple ${kind.toLowerCase()} records matched the selector. Provide a more exact selector.`, {
      selector,
      candidates: viable.map(({ id, name, email }) => ({ id, name, email }))
    });
  }
  return viable[0]!;
}

function narrowPeople(values: unknown[], params: Record<string, unknown>): Array<{ id: number; name?: string; email?: string; raw: unknown }> {
  const email = typeof params.email === "string" ? params.email.toLowerCase() : undefined;
  const name = typeof params.name === "string" ? params.name.toLowerCase() : undefined;
  return values
    .filter((value) => {
      if (email && stringField(value, ["email"])?.toLowerCase() !== email) {
        return false;
      }
      if (name && !stringField(value, ["name", "displayName"])?.toLowerCase().includes(name)) {
        return false;
      }
      return true;
    })
    .map(candidateFromUnknown);
}

function narrowByName(values: unknown[], name: string | undefined, keys: string[] = ["name", "title"]): unknown[] {
  if (!name) {
    return values;
  }
  const lowerName = name.toLowerCase();
  return values.filter((value) => stringField(value, keys)?.toLowerCase().includes(lowerName));
}

function maybeFilterInactive(values: unknown[], includeInactive: boolean | undefined): unknown[] {
  if (includeInactive) {
    return values;
  }
  return values.filter((value) => {
    const object = asRecord(value);
    const status = String(object?.status ?? object?.memberStatus ?? object?.groupStatus ?? "").toLowerCase();
    const active = object?.active ?? object?.isActive;
    if (active === false) {
      return false;
    }
    return !["inactive", "archived", "deleted"].includes(status);
  });
}

function looksLikeLeaderMembership(value: unknown): boolean {
  const object = asRecord(value);
  const role = [
    object?.role,
    object?.roleName,
    object?.groupMemberRole,
    asRecord(object?.member)?.role,
    asRecord(object?.member)?.roleName
  ]
    .filter((candidate) => typeof candidate === "string")
    .join(" ")
    .toLowerCase();

  return /\b(leader|lead|leiter|leitung|co-leader|coleader)\b/.test(role);
}

function filterByDate(values: unknown[], params: Record<string, unknown>): unknown[] {
  const from = typeof params.from === "string" ? Date.parse(params.from) : undefined;
  const to = typeof params.to === "string" ? Date.parse(params.to) : undefined;
  if (!from && !to) {
    return values;
  }
  return values.filter((value) => {
    const dateValue = stringField(value, ["startDate", "start", "date", "from"]);
    const timestamp = dateValue ? Date.parse(dateValue) : NaN;
    if (Number.isNaN(timestamp)) {
      return true;
    }
    if (from && timestamp < from) {
      return false;
    }
    if (to && timestamp > to) {
      return false;
    }
    return true;
  });
}

function unwrapEventItems(value: unknown): unknown[] {
  return Array.isArray(value) ? value : unwrapList(value);
}
