import { z } from "zod";
import {
  DEFAULT_HOST,
  DEFAULT_MAX_RESPONSE_BYTES,
  DEFAULT_OPENAPI_PATH,
  DEFAULT_PORT,
  DEFAULT_REQUEST_TIMEOUT_MS
} from "./constants.js";

export interface AppConfig {
  port: number;
  host: string;
  logLevel: string;
  churchToolsBaseUrl: string;
  churchToolsAuthMode: "pat" | "pat-forwarding";
  churchToolsPat?: string;
  churchToolsOpenApiUrl: string;
  allowUnauthenticatedMcp: boolean;
  mcpServerToken?: string;
  requestTimeoutMs: number;
  maxResponseBytes: number;
}

const EnvSchema = z
  .object({
    PORT: z.string().optional(),
    HOST: z.string().optional(),
    LOG_LEVEL: z.string().optional(),
    CHURCHTOOLS_BASE_URL: z.string().min(1),
    CHURCHTOOLS_AUTH_MODE: z.enum(["pat", "pat-forwarding"]),
    CHURCHTOOLS_PAT: z.string().optional(),
    CHURCHTOOLS_OPENAPI_URL: z.string().optional(),
    ALLOW_UNAUTHENTICATED_MCP: z.string().optional(),
    MCP_SERVER_TOKEN: z.string().optional(),
    REQUEST_TIMEOUT_MS: z.string().optional(),
    MAX_RESPONSE_BYTES: z.string().optional()
  })
  .passthrough();

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === "") {
    return defaultValue;
  }

  if (["1", "true", "yes", "on"].includes(value.toLowerCase())) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(value.toLowerCase())) {
    return false;
  }

  throw new Error(`Invalid boolean value: ${value}`);
}

function parsePositiveInt(value: string | undefined, name: string, defaultValue: number): number {
  if (value === undefined || value === "") {
    return defaultValue;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

export function normalizeChurchToolsBaseUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.hash = "";
  url.search = "";

  const normalizedPath = url.pathname.replace(/\/$/, "");
  if (normalizedPath.endsWith("/api")) {
    url.pathname = normalizedPath.slice(0, -4) || "/";
  }

  return url.toString().replace(/\/$/, "");
}

function defaultOpenApiUrl(baseUrl: string): string {
  return `${baseUrl}${DEFAULT_OPENAPI_PATH}`;
}

export function parseConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid environment:\n${formatEnvIssues(parsed.error.issues)}`);
  }

  const baseUrl = normalizeChurchToolsBaseUrl(parsed.data.CHURCHTOOLS_BASE_URL);
  const allowUnauthenticatedMcp = parseBoolean(parsed.data.ALLOW_UNAUTHENTICATED_MCP, false);

  if (parsed.data.CHURCHTOOLS_AUTH_MODE === "pat" && !parsed.data.CHURCHTOOLS_PAT) {
    throw new Error("CHURCHTOOLS_PAT is required when CHURCHTOOLS_AUTH_MODE=pat");
  }

  if (!allowUnauthenticatedMcp && !parsed.data.MCP_SERVER_TOKEN) {
    throw new Error("MCP_SERVER_TOKEN is required unless ALLOW_UNAUTHENTICATED_MCP=true");
  }

  return {
    port: parsePositiveInt(parsed.data.PORT, "PORT", DEFAULT_PORT),
    host: parsed.data.HOST || DEFAULT_HOST,
    logLevel: parsed.data.LOG_LEVEL || "info",
    churchToolsBaseUrl: baseUrl,
    churchToolsAuthMode: parsed.data.CHURCHTOOLS_AUTH_MODE,
    ...(parsed.data.CHURCHTOOLS_PAT ? { churchToolsPat: parsed.data.CHURCHTOOLS_PAT } : {}),
    churchToolsOpenApiUrl: parsed.data.CHURCHTOOLS_OPENAPI_URL || defaultOpenApiUrl(baseUrl),
    allowUnauthenticatedMcp,
    ...(parsed.data.MCP_SERVER_TOKEN ? { mcpServerToken: parsed.data.MCP_SERVER_TOKEN } : {}),
    requestTimeoutMs: parsePositiveInt(
      parsed.data.REQUEST_TIMEOUT_MS,
      "REQUEST_TIMEOUT_MS",
      DEFAULT_REQUEST_TIMEOUT_MS
    ),
    maxResponseBytes: parsePositiveInt(
      parsed.data.MAX_RESPONSE_BYTES,
      "MAX_RESPONSE_BYTES",
      DEFAULT_MAX_RESPONSE_BYTES
    )
  };
}

function formatEnvIssues(issues: z.ZodIssue[]): string {
  return issues
    .map((issue) => {
      const name = issue.path.join(".") || "environment";

      if (issue.code === "invalid_type" && issue.received === "undefined") {
        return `- ${name} is required`;
      }

      if (issue.code === "invalid_enum_value" && name === "CHURCHTOOLS_AUTH_MODE") {
        return "- CHURCHTOOLS_AUTH_MODE must be set to \"pat\" or \"pat-forwarding\"";
      }

      return `- ${name}: ${issue.message}`;
    })
    .join("\n");
}
