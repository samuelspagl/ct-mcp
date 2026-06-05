import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { ChurchToolsRequestContext, ChurchToolsRequester, ResponseFormat } from "../types.js";
import { compactBody, extractArray, extractObject } from "../utils/object.js";
import { formatErrorResult, formatToolResult, type ToolResult } from "../utils/format.js";
import { requestChurchTools } from "../utils/apiRequest.js";
import { ConfirmationHost, requireWriteConfirmation } from "./confirmation.js";
import { ResponseFormatSchema } from "./schemas.js";

const NullableStringSchema = z.union([z.string(), z.null()]);

const updateSongInputSchema = {
  songId: z.number().int().describe("Song ID."),
  name: z.string().min(2).max(200).optional().describe("Song name. If omitted, the current value is preserved."),
  categoryId: z.number().int().optional().describe("Song category ID. If omitted, the current value is preserved."),
  tags: z.array(z.string().min(1).max(255)).optional().describe("Full replacement tag list for the song."),
  author: NullableStringSchema.optional().describe("Song author."),
  ccli: NullableStringSchema.optional().describe("CCLI number."),
  copyright: NullableStringSchema.optional().describe("Copyright text."),
  shouldPractice: z.boolean().optional().describe("Whether the song should be practiced."),
  arrangements: z.array(z.record(z.unknown())).optional().describe("Full replacement arrangements array."),
  confirm: z.boolean().optional().describe("Set true after confirmation fallback asks for a retry."),
  response_format: ResponseFormatSchema
};

const updateEventInputSchema = {
  eventId: z.number().int().describe("Event ID."),
  adminIds: z.array(z.number().int()).optional().describe("Full replacement admin ID list."),
  isCanceled: z.boolean().optional().describe("Whether the event is canceled."),
  note: NullableStringSchema.optional().describe("Event note."),
  confirm: z.boolean().optional().describe("Set true after confirmation fallback asks for a retry."),
  response_format: ResponseFormatSchema
};

const updateWikiCategoryInputSchema = {
  wikiCategoryId: z.number().int().describe("Wiki category ID."),
  name: z.string().min(1).optional().describe("Category name. If omitted, the current value is preserved."),
  sortKey: z.number().int().optional().describe("Sort key. If omitted, the current value is preserved."),
  inMenu: z.boolean().optional().describe("Whether the category appears in the menu."),
  fileAccessWithoutPermission: z.boolean().optional().describe("Whether files can be accessed without permission."),
  campusId: z.union([z.number().int(), z.null()]).optional().describe("Campus ID or null."),
  confirm: z.boolean().optional().describe("Set true after confirmation fallback asks for a retry."),
  response_format: ResponseFormatSchema
};

interface ToolRequestExtra {
  authInfo?: AuthInfo;
}

export function registerWriteTools(
  server: McpServer,
  api: ChurchToolsRequester,
  config: Pick<AppConfig, "maxResponseBytes">
): void {
  const confirmationHost = () => server as unknown as ConfirmationHost;

  server.registerTool(
    "ct_update_song",
    {
      title: "Update ChurchTools Song",
      description: "Update a song by ID, including tags. Missing required ChurchTools PUT fields are preserved from the current song.",
      inputSchema: updateSongInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params, extra: ToolRequestExtra) =>
      runUpdateSong(api, params as UpdateSongParams, config, confirmationHost(), toolContext(extra))
  );

  server.registerTool(
    "ct_update_event",
    {
      title: "Update ChurchTools Event",
      description: "Update mutable event fields: adminIds, isCanceled, and note.",
      inputSchema: updateEventInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params, extra: ToolRequestExtra) =>
      runUpdateEvent(api, params as UpdateEventParams, config, confirmationHost(), toolContext(extra))
  );

  server.registerTool(
    "ct_update_wiki_category",
    {
      title: "Update ChurchTools Wiki Category",
      description: "Update a wiki category. This server does not invent wiki page writes because the OpenAPI document only exposes category writes.",
      inputSchema: updateWikiCategoryInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params, extra: ToolRequestExtra) =>
      runUpdateWikiCategory(api, params as UpdateWikiCategoryParams, config, confirmationHost(), toolContext(extra))
  );
}

export type UpdateSongParams = z.infer<z.ZodObject<typeof updateSongInputSchema>>;
export type UpdateEventParams = z.infer<z.ZodObject<typeof updateEventInputSchema>>;
export type UpdateWikiCategoryParams = z.infer<z.ZodObject<typeof updateWikiCategoryInputSchema>>;

export async function runUpdateSong(
  api: ChurchToolsRequester,
  params: UpdateSongParams,
  config: Pick<AppConfig, "maxResponseBytes">,
  confirmationHost?: ConfirmationHost,
  context: ChurchToolsRequestContext = {}
): Promise<ToolResult> {
  try {
    const explicitBody = compactBody({
      name: params.name,
      categoryId: params.categoryId,
      tags: params.tags,
      author: params.author,
      ccli: params.ccli,
      copyright: params.copyright,
      shouldPractice: params.shouldPractice,
      arrangements: params.arrangements
    });

    if (Object.keys(explicitBody).length === 0) {
      throw new Error("Provide at least one song field to update.");
    }

    const current = await requestChurchTools(api, { method: "GET", path: `/songs/${params.songId}` }, context);
    const currentSong = extractObject(current);
    const body = {
      name: params.name ?? getString(currentSong, "name"),
      categoryId: params.categoryId ?? getNumber(currentSong, "categoryId") ?? getNestedNumber(currentSong, "category", "id"),
      ...explicitBody
    };

    if (!body.name || body.categoryId === undefined) {
      throw new Error("ChurchTools requires song name and categoryId for PUT /songs/{songId}; current values could not be inferred.");
    }

    const confirmation = await requireWriteConfirmation(confirmationHost, {
      confirm: params.confirm,
      operation: "PUT /songs/{songId}",
      target: `song ${params.songId}`,
      preview: body
    });
    if (!confirmation.confirmed) {
      return confirmation.result;
    }

    const data = await requestChurchTools(api, { method: "PUT", path: `/songs/${params.songId}`, body }, context);
    return formatToolResult(data, {
      title: "Updated ChurchTools Song",
      responseFormat: params.response_format as ResponseFormat,
      config
    });
  } catch (error) {
    return formatErrorResult(error);
  }
}

export async function runUpdateEvent(
  api: ChurchToolsRequester,
  params: UpdateEventParams,
  config: Pick<AppConfig, "maxResponseBytes">,
  confirmationHost?: ConfirmationHost,
  context: ChurchToolsRequestContext = {}
): Promise<ToolResult> {
  try {
    const body = compactBody({
      adminIds: params.adminIds,
      isCanceled: params.isCanceled,
      note: params.note
    });

    if (Object.keys(body).length === 0) {
      throw new Error("Provide at least one event field to update.");
    }

    const confirmation = await requireWriteConfirmation(confirmationHost, {
      confirm: params.confirm,
      operation: "PUT /events/{eventId}",
      target: `event ${params.eventId}`,
      preview: body
    });
    if (!confirmation.confirmed) {
      return confirmation.result;
    }

    const data = await requestChurchTools(api, { method: "PUT", path: `/events/${params.eventId}`, body }, context);
    return formatToolResult(data, {
      title: "Updated ChurchTools Event",
      responseFormat: params.response_format as ResponseFormat,
      config
    });
  } catch (error) {
    return formatErrorResult(error);
  }
}

export async function runUpdateWikiCategory(
  api: ChurchToolsRequester,
  params: UpdateWikiCategoryParams,
  config: Pick<AppConfig, "maxResponseBytes">,
  confirmationHost?: ConfirmationHost,
  context: ChurchToolsRequestContext = {}
): Promise<ToolResult> {
  try {
    const explicitBody = compactBody({
      name: params.name,
      sortKey: params.sortKey,
      inMenu: params.inMenu,
      fileAccessWithoutPermission: params.fileAccessWithoutPermission,
      campusId: params.campusId
    });

    if (Object.keys(explicitBody).length === 0) {
      throw new Error("Provide at least one wiki category field to update.");
    }

    const categoriesResponse = await requestChurchTools(api, { method: "GET", path: "/wiki/categories" }, context);
    const currentCategory = extractArray(categoriesResponse)
      .map((item) => extractObject(item))
      .find((category) => getNumber(category, "id") === params.wikiCategoryId);

    const body = {
      name: params.name ?? (currentCategory ? getString(currentCategory, "name") : undefined),
      sortKey: params.sortKey ?? (currentCategory ? getNumber(currentCategory, "sortKey") : undefined),
      inMenu: params.inMenu ?? (currentCategory ? getBoolean(currentCategory, "inMenu") : undefined),
      fileAccessWithoutPermission:
        params.fileAccessWithoutPermission ??
        (currentCategory ? getBoolean(currentCategory, "fileAccessWithoutPermission") : undefined),
      ...(currentCategory && "campusId" in currentCategory ? { campusId: currentCategory.campusId } : {}),
      ...explicitBody
    };

    if (
      body.name === undefined ||
      body.sortKey === undefined ||
      body.inMenu === undefined ||
      body.fileAccessWithoutPermission === undefined
    ) {
      throw new Error("ChurchTools requires name, sortKey, inMenu, and fileAccessWithoutPermission for wiki category updates; current values could not be inferred.");
    }

    const confirmation = await requireWriteConfirmation(confirmationHost, {
      confirm: params.confirm,
      operation: "PUT /wiki/categories/{wikiCategoryId}",
      target: `wiki category ${params.wikiCategoryId}`,
      preview: body
    });
    if (!confirmation.confirmed) {
      return confirmation.result;
    }

    const data = await requestChurchTools(api, { method: "PUT", path: `/wiki/categories/${params.wikiCategoryId}`, body }, context);
    return formatToolResult(data, {
      title: "Updated ChurchTools Wiki Category",
      responseFormat: params.response_format as ResponseFormat,
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

function getString(object: Record<string, unknown>, key: string): string | undefined {
  return typeof object[key] === "string" ? object[key] : undefined;
}

function getNumber(object: Record<string, unknown>, key: string): number | undefined {
  return typeof object[key] === "number" ? object[key] : undefined;
}

function getBoolean(object: Record<string, unknown>, key: string): boolean | undefined {
  return typeof object[key] === "boolean" ? object[key] : undefined;
}

function getNestedNumber(object: Record<string, unknown>, key: string, nestedKey: string): number | undefined {
  const nested = object[key];
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return getNumber(nested as Record<string, unknown>, nestedKey);
  }
  return undefined;
}
