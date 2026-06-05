import { z } from "zod";
import {
  DEFAULT_HOST,
  DEFAULT_MAX_RESPONSE_BYTES,
  DEFAULT_MCP_ACCESS_TOKEN_TTL_SECONDS,
  DEFAULT_MCP_REFRESH_TOKEN_TTL_SECONDS,
  DEFAULT_OAUTH_TOKEN_STORE_PATH,
  DEFAULT_OPENAPI_PATH,
  DEFAULT_PORT,
  DEFAULT_REQUEST_TIMEOUT_MS
} from "./constants.js";

export type ChurchToolsAuthMode = "pat" | "oauth";

export interface AppConfig {
  port: number;
  host: string;
  logLevel: string;
  churchToolsBaseUrl: string;
  churchToolsAuthMode: ChurchToolsAuthMode;
  churchToolsPat?: string;
  churchToolsOpenApiUrl: string;
  allowUnauthenticatedMcp: boolean;
  mcpServerToken?: string;
  publicBaseUrl?: string;
  mcpTokenSigningSecret?: string;
  tokenEncryptionKey?: string;
  oauthTokenStorePath: string;
  mcpAccessTokenTtlSeconds: number;
  mcpRefreshTokenTtlSeconds: number;
  churchToolsOAuthClientId?: string;
  churchToolsOAuthClientSecret?: string;
  churchToolsOAuthAuthorizeUrl?: string;
  churchToolsOAuthTokenUrl?: string;
  churchToolsOAuthProfileUrl?: string;
  churchToolsOAuthScope?: string;
  requestTimeoutMs: number;
  maxResponseBytes: number;
}

const EnvSchema = z
  .object({
    PORT: z.string().optional(),
    HOST: z.string().optional(),
    LOG_LEVEL: z.string().optional(),
    CHURCHTOOLS_BASE_URL: z.string().min(1),
    CHURCHTOOLS_AUTH_MODE: z.enum(["pat", "oauth"]),
    CHURCHTOOLS_PAT: z.string().optional(),
    CHURCHTOOLS_OPENAPI_URL: z.string().optional(),
    ALLOW_UNAUTHENTICATED_MCP: z.string().optional(),
    MCP_SERVER_TOKEN: z.string().optional(),
    PUBLIC_BASE_URL: z.string().optional(),
    MCP_TOKEN_SIGNING_SECRET: z.string().optional(),
    TOKEN_ENCRYPTION_KEY: z.string().optional(),
    OAUTH_TOKEN_STORE_PATH: z.string().optional(),
    MCP_ACCESS_TOKEN_TTL_SECONDS: z.string().optional(),
    MCP_REFRESH_TOKEN_TTL_SECONDS: z.string().optional(),
    CHURCHTOOLS_OAUTH_CLIENT_ID: z.string().optional(),
    CHURCHTOOLS_OAUTH_CLIENT_SECRET: z.string().optional(),
    CHURCHTOOLS_OAUTH_AUTHORIZE_URL: z.string().optional(),
    CHURCHTOOLS_OAUTH_TOKEN_URL: z.string().optional(),
    CHURCHTOOLS_OAUTH_PROFILE_URL: z.string().optional(),
    CHURCHTOOLS_OAUTH_SCOPE: z.string().optional(),
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

  if (parsed.data.CHURCHTOOLS_AUTH_MODE === "pat" && !allowUnauthenticatedMcp && !parsed.data.MCP_SERVER_TOKEN) {
    throw new Error("MCP_SERVER_TOKEN is required unless ALLOW_UNAUTHENTICATED_MCP=true");
  }

  if (parsed.data.CHURCHTOOLS_AUTH_MODE === "oauth") {
    validateOAuthConfig(parsed.data);
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
    ...(parsed.data.PUBLIC_BASE_URL ? { publicBaseUrl: normalizePublicBaseUrl(parsed.data.PUBLIC_BASE_URL) } : {}),
    ...(parsed.data.MCP_TOKEN_SIGNING_SECRET
      ? { mcpTokenSigningSecret: parsed.data.MCP_TOKEN_SIGNING_SECRET }
      : {}),
    ...(parsed.data.TOKEN_ENCRYPTION_KEY ? { tokenEncryptionKey: parsed.data.TOKEN_ENCRYPTION_KEY } : {}),
    oauthTokenStorePath: parsed.data.OAUTH_TOKEN_STORE_PATH || DEFAULT_OAUTH_TOKEN_STORE_PATH,
    mcpAccessTokenTtlSeconds: parsePositiveInt(
      parsed.data.MCP_ACCESS_TOKEN_TTL_SECONDS,
      "MCP_ACCESS_TOKEN_TTL_SECONDS",
      DEFAULT_MCP_ACCESS_TOKEN_TTL_SECONDS
    ),
    mcpRefreshTokenTtlSeconds: parsePositiveInt(
      parsed.data.MCP_REFRESH_TOKEN_TTL_SECONDS,
      "MCP_REFRESH_TOKEN_TTL_SECONDS",
      DEFAULT_MCP_REFRESH_TOKEN_TTL_SECONDS
    ),
    ...(parsed.data.CHURCHTOOLS_OAUTH_CLIENT_ID
      ? { churchToolsOAuthClientId: parsed.data.CHURCHTOOLS_OAUTH_CLIENT_ID }
      : {}),
    ...(parsed.data.CHURCHTOOLS_OAUTH_CLIENT_SECRET
      ? { churchToolsOAuthClientSecret: parsed.data.CHURCHTOOLS_OAUTH_CLIENT_SECRET }
      : {}),
    ...(parsed.data.CHURCHTOOLS_OAUTH_AUTHORIZE_URL
      ? { churchToolsOAuthAuthorizeUrl: parsed.data.CHURCHTOOLS_OAUTH_AUTHORIZE_URL }
      : {}),
    ...(parsed.data.CHURCHTOOLS_OAUTH_TOKEN_URL
      ? { churchToolsOAuthTokenUrl: parsed.data.CHURCHTOOLS_OAUTH_TOKEN_URL }
      : {}),
    ...(parsed.data.CHURCHTOOLS_OAUTH_PROFILE_URL
      ? { churchToolsOAuthProfileUrl: parsed.data.CHURCHTOOLS_OAUTH_PROFILE_URL }
      : {}),
    ...(parsed.data.CHURCHTOOLS_OAUTH_SCOPE ? { churchToolsOAuthScope: parsed.data.CHURCHTOOLS_OAUTH_SCOPE } : {}),
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

function validateOAuthConfig(data: z.infer<typeof EnvSchema>): void {
  const required = [
    "PUBLIC_BASE_URL",
    "MCP_TOKEN_SIGNING_SECRET",
    "TOKEN_ENCRYPTION_KEY",
    "CHURCHTOOLS_OAUTH_CLIENT_ID",
    "CHURCHTOOLS_OAUTH_CLIENT_SECRET",
    "CHURCHTOOLS_OAUTH_AUTHORIZE_URL",
    "CHURCHTOOLS_OAUTH_TOKEN_URL"
  ] as const;

  const missing = required.filter((name) => !data[name]);
  if (missing.length > 0) {
    throw new Error(
      `Invalid OAuth environment:\n${missing.map((name) => `- ${name} is required when CHURCHTOOLS_AUTH_MODE=oauth`).join("\n")}`
    );
  }

  if (data.MCP_TOKEN_SIGNING_SECRET && data.MCP_TOKEN_SIGNING_SECRET.length < 32) {
    throw new Error("MCP_TOKEN_SIGNING_SECRET must be at least 32 characters");
  }

  if (data.TOKEN_ENCRYPTION_KEY && data.TOKEN_ENCRYPTION_KEY.length < 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be at least 32 characters");
  }

  if (data.PUBLIC_BASE_URL) {
    const publicUrl = new URL(data.PUBLIC_BASE_URL);
    const isLocalhost = ["localhost", "127.0.0.1"].includes(publicUrl.hostname);
    if (publicUrl.protocol !== "https:" && !isLocalhost) {
      throw new Error("PUBLIC_BASE_URL must use HTTPS in OAuth mode unless it is localhost");
    }
  }
}

function normalizePublicBaseUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/$/, "");
}

function formatEnvIssues(issues: z.ZodIssue[]): string {
  return issues
    .map((issue) => {
      const name = issue.path.join(".") || "environment";

      if (issue.code === "invalid_type" && issue.received === "undefined") {
        return `- ${name} is required`;
      }

      if (issue.code === "invalid_enum_value" && name === "CHURCHTOOLS_AUTH_MODE") {
        return "- CHURCHTOOLS_AUTH_MODE must be set to \"pat\" or \"oauth\"";
      }

      return `- ${name}: ${issue.message}`;
    })
    .join("\n");
}
