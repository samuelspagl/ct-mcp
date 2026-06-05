import type { AppConfig } from "../config.js";

export interface ChurchToolsTokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenType: string;
  scope?: string;
}

export class ChurchToolsOAuthError extends Error {
  constructor(
    message: string,
    public readonly phase: "token" | "profile" | "profile_parse",
    public readonly status?: number,
    public readonly upstreamError?: string,
    public readonly upstreamErrorDescription?: string
  ) {
    super(message);
    this.name = "ChurchToolsOAuthError";
  }
}

interface OAuthTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
}

export class ChurchToolsOAuthClient {
  constructor(
    private readonly config: Pick<
      AppConfig,
      | "churchToolsBaseUrl"
      | "churchToolsOAuthClientId"
      | "churchToolsOAuthClientSecret"
      | "churchToolsOAuthAuthorizeUrl"
      | "churchToolsOAuthTokenUrl"
      | "churchToolsOAuthProfileUrl"
      | "churchToolsOAuthScope"
      | "requestTimeoutMs"
    >
  ) {}

  buildAuthorizeUrl(state: string, redirectUri: string): string {
    const url = new URL(required(this.config.churchToolsOAuthAuthorizeUrl, "CHURCHTOOLS_OAUTH_AUTHORIZE_URL"));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", required(this.config.churchToolsOAuthClientId, "CHURCHTOOLS_OAUTH_CLIENT_ID"));
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    if (this.config.churchToolsOAuthScope) {
      url.searchParams.set("scope", this.config.churchToolsOAuthScope);
    }
    return url.href;
  }

  async exchangeAuthorizationCode(code: string, redirectUri: string): Promise<ChurchToolsTokenSet> {
    return this.exchange({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri
    });
  }

  async refreshAccessToken(refreshToken: string): Promise<ChurchToolsTokenSet> {
    return this.exchange({
      grant_type: "refresh_token",
      refresh_token: refreshToken
    });
  }

  async loadProfile(accessToken: string): Promise<Record<string, unknown>> {
    const profileUrl = this.config.churchToolsOAuthProfileUrl || `${this.config.churchToolsBaseUrl}/oauth/userinfo`;
    const response = await fetch(profileUrl, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`
      },
      signal: AbortSignal.timeout(this.config.requestTimeoutMs)
    });

    if (!response.ok) {
      const error = await parseOAuthErrorResponse(response);
      throw new ChurchToolsOAuthError(
        formatOAuthErrorMessage("ChurchTools OAuth profile request failed", response.status, error),
        "profile",
        response.status,
        error.error,
        error.errorDescription
      );
    }

    const body = (await response.json()) as unknown;
    try {
      return normalizeProfile(body);
    } catch (error) {
      throw new ChurchToolsOAuthError(
        error instanceof Error ? error.message : "ChurchTools OAuth profile response could not be parsed.",
        "profile_parse"
      );
    }
  }

  private async exchange(params: Record<string, string>): Promise<ChurchToolsTokenSet> {
    const body = new URLSearchParams({
      ...params,
      client_id: required(this.config.churchToolsOAuthClientId, "CHURCHTOOLS_OAUTH_CLIENT_ID"),
      client_secret: required(this.config.churchToolsOAuthClientSecret, "CHURCHTOOLS_OAUTH_CLIENT_SECRET")
    });

    const response = await fetch(required(this.config.churchToolsOAuthTokenUrl, "CHURCHTOOLS_OAUTH_TOKEN_URL"), {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body,
      signal: AbortSignal.timeout(this.config.requestTimeoutMs)
    });

    if (!response.ok) {
      const error = await parseOAuthErrorResponse(response);
      throw new ChurchToolsOAuthError(
        formatOAuthErrorMessage("ChurchTools OAuth token request failed", response.status, error),
        "token",
        response.status,
        error.error,
        error.errorDescription
      );
    }

    const tokenResponse = (await response.json()) as OAuthTokenResponse;
    if (!tokenResponse.access_token) {
      throw new ChurchToolsOAuthError(
        "ChurchTools OAuth token response did not include an access token.",
        "token"
      );
    }

    return {
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      expiresAt: tokenResponse.expires_in ? Math.floor(Date.now() / 1000) + tokenResponse.expires_in : undefined,
      tokenType: tokenResponse.token_type || "Bearer",
      scope: tokenResponse.scope
    };
  }
}

interface ParsedOAuthError {
  error?: string;
  errorDescription?: string;
}

async function parseOAuthErrorResponse(response: Response): Promise<ParsedOAuthError> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return {};
  }

  try {
    const body = (await response.json()) as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return {};
    }

    const objectBody = body as Record<string, unknown>;
    return {
      error: typeof objectBody.error === "string" ? objectBody.error : undefined,
      errorDescription:
        typeof objectBody.error_description === "string"
          ? truncateSafeError(objectBody.error_description)
          : undefined
    };
  } catch {
    return {};
  }
}

function formatOAuthErrorMessage(prefix: string, status: number, error: ParsedOAuthError): string {
  const upstream = [error.error, error.errorDescription].filter(Boolean).join(": ");
  return upstream ? `${prefix} with status ${status}: ${upstream}` : `${prefix} with status ${status}`;
}

function truncateSafeError(value: string): string {
  return value.length > 300 ? `${value.slice(0, 300)}...` : value;
}

export function extractChurchToolsUserId(profile: Record<string, unknown>): string {
  const candidates = [
    profile.id,
    profile.user_id,
    profile.userId,
    profile.personId,
    nested(profile, "person", "id"),
    nested(profile, "data", "id"),
    nested(profile, "data", "personId"),
    nested(profile, "data", "person", "id"),
    profile.guid,
    profile.email,
    nested(profile, "data", "email")
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return String(candidate);
    }
  }

  throw new Error("Unable to determine ChurchTools user ID from OAuth profile response.");
}

function normalizeProfile(body: unknown): Record<string, unknown> {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const objectBody = body as Record<string, unknown>;
    if (objectBody.data && typeof objectBody.data === "object" && !Array.isArray(objectBody.data)) {
      return objectBody.data as Record<string, unknown>;
    }
    return objectBody;
  }

  throw new Error("ChurchTools OAuth profile response was not an object.");
}

function nested(object: Record<string, unknown>, first: string, second: string, third?: string): unknown {
  const levelOne = object[first];
  if (!levelOne || typeof levelOne !== "object" || Array.isArray(levelOne)) {
    return undefined;
  }
  const levelTwo = (levelOne as Record<string, unknown>)[second];
  if (!third) {
    return levelTwo;
  }
  if (!levelTwo || typeof levelTwo !== "object" || Array.isArray(levelTwo)) {
    return undefined;
  }
  return (levelTwo as Record<string, unknown>)[third];
}

function required(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}
