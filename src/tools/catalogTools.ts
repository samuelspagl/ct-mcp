import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { ChurchToolsRequestContext, ChurchToolsRequester, ResponseFormat } from "../types.js";
import { formatErrorResult, formatToolResult, type ToolResult } from "../utils/format.js";
import { requestChurchTools } from "../utils/apiRequest.js";
import { OpenApiCatalog, summarizeOperation } from "../services/openApiCatalog.js";
import { ConfirmationHost, requireWriteConfirmation } from "./confirmation.js";
import { PathParamsSchema, QueryRecordSchema, ResponseFormatSchema, UnknownBodySchema } from "./schemas.js";

const searchActionsInputSchema = {
  query: z.string().default("").describe("Natural-language intent or endpoint keywords."),
  limit: z.number().int().min(1).max(50).default(10).describe("Maximum matching actions to return."),
  mode: z.enum(["all", "read", "write"]).default("all").describe("Restrict results to read or write operations."),
  response_format: ResponseFormatSchema
};

const executeReadInputSchema = {
  action_id: z.string().min(1).describe("OpenAPI operation ID returned by churchtools_search_actions."),
  path_params: PathParamsSchema,
  query: QueryRecordSchema,
  response_format: ResponseFormatSchema
};

const executeWriteInputSchema = {
  action_id: z.string().min(1).describe("OpenAPI operation ID returned by churchtools_search_actions."),
  path_params: PathParamsSchema,
  query: QueryRecordSchema,
  body: UnknownBodySchema,
  confirm: z.boolean().optional().describe("Set true after confirmation fallback asks for a retry."),
  response_format: ResponseFormatSchema
};

interface ToolRequestExtra {
  authInfo?: AuthInfo;
}

export function registerCatalogTools(
  server: McpServer,
  api: ChurchToolsRequester,
  catalog: OpenApiCatalog,
  config: Pick<AppConfig, "maxResponseBytes">
): void {
  const confirmationHost = () => server as unknown as ConfirmationHost;

  server.registerTool(
    "churchtools_search_actions",
    {
      title: "Search ChurchTools Actions",
      description: "Search the ChurchTools OpenAPI catalog for read or write operations. Use before generic execute tools.",
      inputSchema: searchActionsInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params) => runSearchActions(catalog, params as SearchActionsParams, config)
  );

  server.registerTool(
    "churchtools_execute_read_action",
    {
      title: "Execute ChurchTools Read Action",
      description: "Execute a GET operation from the ChurchTools OpenAPI catalog by operation ID.",
      inputSchema: executeReadInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params, extra: ToolRequestExtra) =>
      runExecuteReadAction(api, catalog, params as ExecuteReadParams, config, toolContext(extra))
  );

  server.registerTool(
    "churchtools_execute_write_action",
    {
      title: "Execute ChurchTools Write Action",
      description: "Execute a non-GET operation from the ChurchTools OpenAPI catalog by operation ID after confirmation.",
      inputSchema: executeWriteInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (params, extra: ToolRequestExtra) =>
      runExecuteWriteAction(api, catalog, params as ExecuteWriteParams, config, confirmationHost(), toolContext(extra))
  );
}

type SearchActionsParams = z.infer<z.ZodObject<typeof searchActionsInputSchema>>;
type ExecuteReadParams = z.infer<z.ZodObject<typeof executeReadInputSchema>>;
type ExecuteWriteParams = z.infer<z.ZodObject<typeof executeWriteInputSchema>>;

export async function runSearchActions(
  catalog: OpenApiCatalog,
  params: SearchActionsParams,
  config: Pick<AppConfig, "maxResponseBytes">
): Promise<ToolResult> {
  const actions = catalog.search(params.query, params.limit, params.mode).map(summarizeOperation);
  return formatToolResult(
    {
      count: actions.length,
      actions
    },
    {
      title: "ChurchTools Action Search Results",
      responseFormat: params.response_format as ResponseFormat,
      config
    }
  );
}

export async function runExecuteReadAction(
  api: ChurchToolsRequester,
  catalog: OpenApiCatalog,
  params: ExecuteReadParams,
  config: Pick<AppConfig, "maxResponseBytes">,
  context: ChurchToolsRequestContext = {}
): Promise<ToolResult> {
  try {
    const operation = catalog.getById(params.action_id);
    if (!operation) {
      throw new Error(`Unknown ChurchTools action: ${params.action_id}`);
    }
    if (!operation.isRead) {
      throw new Error(`${params.action_id} is not a read action. Use churchtools_execute_write_action.`);
    }

    const request = catalog.buildRequest({
      actionId: params.action_id,
      pathParams: params.path_params,
      query: params.query
    });
    const data = await requestChurchTools(api, request, context);
    return formatToolResult(data, {
      title: `ChurchTools ${operation.id}`,
      responseFormat: params.response_format as ResponseFormat,
      config
    });
  } catch (error) {
    return formatErrorResult(error);
  }
}

export async function runExecuteWriteAction(
  api: ChurchToolsRequester,
  catalog: OpenApiCatalog,
  params: ExecuteWriteParams,
  config: Pick<AppConfig, "maxResponseBytes">,
  confirmationHost?: ConfirmationHost,
  context: ChurchToolsRequestContext = {}
): Promise<ToolResult> {
  try {
    const operation = catalog.getById(params.action_id);
    if (!operation) {
      throw new Error(`Unknown ChurchTools action: ${params.action_id}`);
    }
    if (operation.isRead) {
      throw new Error(`${params.action_id} is a read action. Use churchtools_execute_read_action.`);
    }

    const request = catalog.buildRequest({
      actionId: params.action_id,
      pathParams: params.path_params,
      query: params.query,
      body: params.body
    });

    const confirmation = await requireWriteConfirmation(confirmationHost, {
      confirm: params.confirm,
      operation: `${operation.method} ${operation.path}`,
      target: operation.id,
      preview: {
        path: request.path,
        query: request.query,
        body: request.body
      }
    });
    if (!confirmation.confirmed) {
      return confirmation.result;
    }

    const data = await requestChurchTools(api, request, context);
    return formatToolResult(data, {
      title: `ChurchTools ${operation.id}`,
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
