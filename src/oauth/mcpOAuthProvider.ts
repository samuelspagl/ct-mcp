import type { Response } from "express";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { AuthorizationParams, OAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { InvalidGrantError, InvalidTargetError, InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { AppConfig } from "../config.js";
import { ChurchToolsOAuthClient, extractChurchToolsUserId } from "./churchtoolsOAuthClient.js";
import { nowSeconds, OAuthTokenStore } from "./tokenStore.js";
import { randomToken } from "./crypto.js";

const PENDING_AUTH_TTL_SECONDS = 10 * 60;
const AUTHORIZATION_CODE_TTL_SECONDS = 5 * 60;

export class McpOAuthProvider implements OAuthServerProvider {
  readonly clientsStore: OAuthRegisteredClientsStore;

  constructor(
    private readonly config: Pick<
      AppConfig,
      | "publicBaseUrl"
      | "mcpAccessTokenTtlSeconds"
      | "mcpRefreshTokenTtlSeconds"
      | "churchToolsOAuthClientId"
      | "churchToolsOAuthClientSecret"
      | "churchToolsOAuthAuthorizeUrl"
      | "churchToolsOAuthTokenUrl"
      | "churchToolsOAuthProfileUrl"
      | "churchToolsOAuthScope"
      | "churchToolsBaseUrl"
      | "requestTimeoutMs"
    >,
    private readonly store: OAuthTokenStore,
    private readonly churchToolsOAuthClient = new ChurchToolsOAuthClient(config)
  ) {
    this.clientsStore = {
      getClient: async (clientId) => this.store.getClient(clientId),
      registerClient: async (client) => this.store.registerClient(client as OAuthClientInformationFull)
    };
  }

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    this.assertValidResource(params.resource);

    const state = randomToken();
    this.store.savePendingAuthorization({
      state,
      clientId: client.client_id,
      redirectUri: params.redirectUri,
      mcpState: params.state,
      scopes: params.scopes ?? [],
      codeChallenge: params.codeChallenge,
      resource: params.resource?.href,
      expiresAt: nowSeconds() + PENDING_AUTH_TTL_SECONDS
    });

    res.redirect(302, this.churchToolsOAuthClient.buildAuthorizeUrl(state, this.churchToolsRedirectUri));
  }

  async handleChurchToolsCallback(code: string, state: string): Promise<string> {
    const pending = this.store.consumePendingAuthorization(state);
    if (!pending) {
      throw new InvalidGrantError("Invalid or expired OAuth state.");
    }

    const churchToolsTokens = await this.churchToolsOAuthClient.exchangeAuthorizationCode(code, this.churchToolsRedirectUri);
    const profile = await this.churchToolsOAuthClient.loadProfile(churchToolsTokens.accessToken);
    const userId = extractChurchToolsUserId(profile);
    this.store.saveChurchToolsTokens(userId, churchToolsTokens, profile);

    const authorizationCode = randomToken();
    this.store.saveAuthorizationCode({
      code: authorizationCode,
      clientId: pending.clientId,
      userId,
      redirectUri: pending.redirectUri,
      codeChallenge: pending.codeChallenge,
      scopes: pending.scopes,
      resource: pending.resource,
      expiresAt: nowSeconds() + AUTHORIZATION_CODE_TTL_SECONDS
    });

    const redirect = new URL(pending.redirectUri);
    redirect.searchParams.set("code", authorizationCode);
    if (pending.mcpState) {
      redirect.searchParams.set("state", pending.mcpState);
    }
    return redirect.href;
  }

  async challengeForAuthorizationCode(_client: OAuthClientInformationFull, authorizationCode: string): Promise<string> {
    const record = this.store.consumeAuthorizationCode(authorizationCode);
    if (!record) {
      throw new InvalidGrantError("Invalid or expired authorization code.");
    }

    this.store.saveAuthorizationCode(record);
    return record.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
    resource?: URL
  ): Promise<OAuthTokens> {
    this.assertValidResource(resource);
    const record = this.store.consumeAuthorizationCode(authorizationCode);
    if (!record || record.clientId !== client.client_id) {
      throw new InvalidGrantError("Invalid authorization code.");
    }
    if (redirectUri && redirectUri !== record.redirectUri) {
      throw new InvalidGrantError("redirect_uri does not match authorization request.");
    }
    if (resource?.href && record.resource && resource.href !== record.resource) {
      throw new InvalidTargetError("resource does not match authorization request.");
    }

    return this.issueMcpTokens({
      clientId: record.clientId,
      userId: record.userId,
      scopes: record.scopes,
      resource: record.resource
    });
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    resource?: URL
  ): Promise<OAuthTokens> {
    this.assertValidResource(resource);
    const record = this.store.consumeRefreshToken(refreshToken);
    if (!record || record.clientId !== client.client_id) {
      throw new InvalidGrantError("Invalid refresh token.");
    }

    const requestedScopes = scopes ?? record.scopes;
    const invalidScope = requestedScopes.some((scope) => !record.scopes.includes(scope));
    if (invalidScope) {
      throw new InvalidGrantError("Requested scope is not covered by refresh token.");
    }

    return this.issueMcpTokens({
      clientId: record.clientId,
      userId: record.userId,
      scopes: requestedScopes,
      resource: resource?.href ?? record.resource
    });
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const authInfo = this.store.getAccessToken(token);
    if (!authInfo) {
      throw new InvalidTokenError("Invalid access token.");
    }

    this.assertValidResource(authInfo.resource);
    return authInfo;
  }

  async revokeToken(_client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    this.store.revokeToken(request.token);
  }

  private issueMcpTokens(input: { clientId: string; userId: string; scopes: string[]; resource?: string }): OAuthTokens {
    const now = nowSeconds();
    const accessTokenExpiresAt = now + this.config.mcpAccessTokenTtlSeconds;
    const refreshTokenExpiresAt = now + this.config.mcpRefreshTokenTtlSeconds;
    const accessToken = this.store.saveAccessToken({
      ...input,
      expiresAt: accessTokenExpiresAt
    });
    const refreshToken = this.store.saveRefreshToken({
      ...input,
      expiresAt: refreshTokenExpiresAt
    });

    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: this.config.mcpAccessTokenTtlSeconds,
      refresh_token: refreshToken,
      scope: input.scopes.join(" ")
    };
  }

  private assertValidResource(resource: URL | undefined): void {
    if (!resource) {
      return;
    }

    if (resource.href.replace(/\/$/, "") !== this.resourceServerUrl.href.replace(/\/$/, "")) {
      throw new InvalidTargetError("Invalid OAuth resource target.");
    }
  }

  private get publicBaseUrl(): string {
    if (!this.config.publicBaseUrl) {
      throw new Error("PUBLIC_BASE_URL is required in OAuth mode.");
    }
    return this.config.publicBaseUrl;
  }

  get resourceServerUrl(): URL {
    return new URL("/mcp", this.publicBaseUrl);
  }

  get issuerUrl(): URL {
    return new URL(this.publicBaseUrl);
  }

  get churchToolsRedirectUri(): string {
    return new URL("/oauth/churchtools/callback", this.publicBaseUrl).href;
  }
}
