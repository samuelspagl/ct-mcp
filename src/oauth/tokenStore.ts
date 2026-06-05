import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { ChurchToolsTokenSet } from "./churchtoolsOAuthClient.js";
import { hashToken, randomToken, TokenEncryption } from "./crypto.js";

interface SqliteStatement {
  get(...values: unknown[]): unknown;
  run(...values: unknown[]): unknown;
}

interface DatabaseSyncLike {
  close(): void;
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
}

type DatabaseSyncConstructor = new (path: string) => DatabaseSyncLike;

const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire("node:sqlite") as { DatabaseSync: DatabaseSyncConstructor };

export interface PendingAuthorization {
  state: string;
  clientId: string;
  redirectUri: string;
  mcpState?: string;
  scopes: string[];
  codeChallenge: string;
  resource?: string;
  expiresAt: number;
}

export interface AuthorizationCodeRecord {
  code: string;
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  scopes: string[];
  resource?: string;
  expiresAt: number;
}

export interface StoredChurchToolsTokens {
  userId: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenType: string;
  scope?: string;
  profile?: Record<string, unknown>;
}

interface StoreRow {
  [key: string]: unknown;
}

export class OAuthTokenStore {
  private readonly db: DatabaseSyncLike;
  private readonly encryption: TokenEncryption;

  constructor(
    path: string,
    encryptionSecret: string,
    private readonly tokenHashSecret: string
  ) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.encryption = new TokenEncryption(encryptionSecret);
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  getClient(clientId: string): OAuthClientInformationFull | undefined {
    const row = this.db.prepare("SELECT client_json FROM oauth_clients WHERE client_id = ?").get(clientId) as
      | StoreRow
      | undefined;
    return typeof row?.client_json === "string" ? (JSON.parse(row.client_json) as OAuthClientInformationFull) : undefined;
  }

  registerClient(client: OAuthClientInformationFull): OAuthClientInformationFull {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO oauth_clients (client_id, client_json, updated_at) VALUES (?, ?, ?)"
      )
      .run(client.client_id, JSON.stringify(client), nowSeconds());
    return client;
  }

  savePendingAuthorization(record: PendingAuthorization): void {
    this.db
      .prepare(
        `INSERT INTO oauth_pending_authorizations
          (state, client_id, redirect_uri, mcp_state, scopes_json, code_challenge, resource, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.state,
        record.clientId,
        record.redirectUri,
        record.mcpState ?? null,
        JSON.stringify(record.scopes),
        record.codeChallenge,
        record.resource ?? null,
        record.expiresAt,
        nowSeconds()
      );
  }

  consumePendingAuthorization(state: string): PendingAuthorization | undefined {
    const row = this.db
      .prepare("SELECT * FROM oauth_pending_authorizations WHERE state = ?")
      .get(state) as StoreRow | undefined;
    this.db.prepare("DELETE FROM oauth_pending_authorizations WHERE state = ?").run(state);

    if (!row || numberValue(row.expires_at) < nowSeconds()) {
      return undefined;
    }

    return {
      state: stringValue(row.state),
      clientId: stringValue(row.client_id),
      redirectUri: stringValue(row.redirect_uri),
      mcpState: optionalString(row.mcp_state),
      scopes: parseJsonArray(row.scopes_json),
      codeChallenge: stringValue(row.code_challenge),
      resource: optionalString(row.resource),
      expiresAt: numberValue(row.expires_at)
    };
  }

  saveChurchToolsTokens(userId: string, tokens: ChurchToolsTokenSet, profile: Record<string, unknown>): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO churchtools_tokens
          (user_id, access_token_enc, refresh_token_enc, expires_at, token_type, scope, profile_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        userId,
        this.encryption.encrypt(tokens.accessToken),
        this.encryption.encrypt(tokens.refreshToken),
        tokens.expiresAt ?? null,
        tokens.tokenType,
        tokens.scope ?? null,
        JSON.stringify(profile),
        nowSeconds()
      );
  }

  getChurchToolsTokens(userId: string): StoredChurchToolsTokens | undefined {
    const row = this.db.prepare("SELECT * FROM churchtools_tokens WHERE user_id = ?").get(userId) as
      | StoreRow
      | undefined;
    if (!row) {
      return undefined;
    }

    return {
      userId,
      accessToken: this.encryption.decrypt(optionalString(row.access_token_enc)) ?? "",
      refreshToken: this.encryption.decrypt(optionalString(row.refresh_token_enc)),
      expiresAt: optionalNumber(row.expires_at),
      tokenType: optionalString(row.token_type) ?? "Bearer",
      scope: optionalString(row.scope),
      profile: parseJsonObject(row.profile_json)
    };
  }

  deleteChurchToolsTokens(userId: string): void {
    this.db.prepare("DELETE FROM churchtools_tokens WHERE user_id = ?").run(userId);
  }

  saveAuthorizationCode(record: AuthorizationCodeRecord): void {
    this.db
      .prepare(
        `INSERT INTO mcp_authorization_codes
          (code_hash, client_id, user_id, redirect_uri, code_challenge, scopes_json, resource, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        hashToken(this.tokenHashSecret, record.code),
        record.clientId,
        record.userId,
        record.redirectUri,
        record.codeChallenge,
        JSON.stringify(record.scopes),
        record.resource ?? null,
        record.expiresAt,
        nowSeconds()
      );
  }

  consumeAuthorizationCode(code: string): AuthorizationCodeRecord | undefined {
    const codeHash = hashToken(this.tokenHashSecret, code);
    const row = this.db
      .prepare("SELECT * FROM mcp_authorization_codes WHERE code_hash = ?")
      .get(codeHash) as StoreRow | undefined;
    this.db.prepare("DELETE FROM mcp_authorization_codes WHERE code_hash = ?").run(codeHash);

    if (!row || numberValue(row.expires_at) < nowSeconds()) {
      return undefined;
    }

    return {
      code,
      clientId: stringValue(row.client_id),
      userId: stringValue(row.user_id),
      redirectUri: stringValue(row.redirect_uri),
      codeChallenge: stringValue(row.code_challenge),
      scopes: parseJsonArray(row.scopes_json),
      resource: optionalString(row.resource),
      expiresAt: numberValue(row.expires_at)
    };
  }

  saveAccessToken(input: {
    clientId: string;
    userId: string;
    scopes: string[];
    resource?: string;
    expiresAt: number;
  }): string {
    const token = randomToken();
    this.db
      .prepare(
        `INSERT INTO mcp_access_tokens
          (token_hash, client_id, user_id, scopes_json, resource, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        hashToken(this.tokenHashSecret, token),
        input.clientId,
        input.userId,
        JSON.stringify(input.scopes),
        input.resource ?? null,
        input.expiresAt,
        nowSeconds()
      );
    return token;
  }

  saveRefreshToken(input: {
    clientId: string;
    userId: string;
    scopes: string[];
    resource?: string;
    expiresAt: number;
  }): string {
    const token = randomToken();
    this.db
      .prepare(
        `INSERT INTO mcp_refresh_tokens
          (token_hash, client_id, user_id, scopes_json, resource, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        hashToken(this.tokenHashSecret, token),
        input.clientId,
        input.userId,
        JSON.stringify(input.scopes),
        input.resource ?? null,
        input.expiresAt,
        nowSeconds()
      );
    return token;
  }

  getAccessToken(token: string): AuthInfo | undefined {
    const row = this.db
      .prepare("SELECT * FROM mcp_access_tokens WHERE token_hash = ?")
      .get(hashToken(this.tokenHashSecret, token)) as StoreRow | undefined;
    if (!row) {
      return undefined;
    }

    return {
      token,
      clientId: stringValue(row.client_id),
      scopes: parseJsonArray(row.scopes_json),
      expiresAt: numberValue(row.expires_at),
      ...(optionalString(row.resource) ? { resource: new URL(optionalString(row.resource) as string) } : {}),
      extra: {
        userId: stringValue(row.user_id)
      }
    };
  }

  consumeRefreshToken(token: string): {
    clientId: string;
    userId: string;
    scopes: string[];
    resource?: string;
    expiresAt: number;
  } | undefined {
    const tokenHash = hashToken(this.tokenHashSecret, token);
    const row = this.db.prepare("SELECT * FROM mcp_refresh_tokens WHERE token_hash = ?").get(tokenHash) as
      | StoreRow
      | undefined;
    this.db.prepare("DELETE FROM mcp_refresh_tokens WHERE token_hash = ?").run(tokenHash);

    if (!row || numberValue(row.expires_at) < nowSeconds()) {
      return undefined;
    }

    return {
      clientId: stringValue(row.client_id),
      userId: stringValue(row.user_id),
      scopes: parseJsonArray(row.scopes_json),
      resource: optionalString(row.resource),
      expiresAt: numberValue(row.expires_at)
    };
  }

  revokeToken(token: string): void {
    const tokenHash = hashToken(this.tokenHashSecret, token);
    this.db.prepare("DELETE FROM mcp_access_tokens WHERE token_hash = ?").run(tokenHash);
    this.db.prepare("DELETE FROM mcp_refresh_tokens WHERE token_hash = ?").run(tokenHash);
  }

  revokeUser(userId: string): void {
    this.deleteChurchToolsTokens(userId);
    this.db.prepare("DELETE FROM mcp_access_tokens WHERE user_id = ?").run(userId);
    this.db.prepare("DELETE FROM mcp_refresh_tokens WHERE user_id = ?").run(userId);
    this.db.prepare("DELETE FROM mcp_authorization_codes WHERE user_id = ?").run(userId);
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS oauth_clients (
        client_id TEXT PRIMARY KEY,
        client_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS oauth_pending_authorizations (
        state TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        redirect_uri TEXT NOT NULL,
        mcp_state TEXT,
        scopes_json TEXT NOT NULL,
        code_challenge TEXT NOT NULL,
        resource TEXT,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS churchtools_tokens (
        user_id TEXT PRIMARY KEY,
        access_token_enc TEXT NOT NULL,
        refresh_token_enc TEXT,
        expires_at INTEGER,
        token_type TEXT NOT NULL,
        scope TEXT,
        profile_json TEXT,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS mcp_authorization_codes (
        code_hash TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        redirect_uri TEXT NOT NULL,
        code_challenge TEXT NOT NULL,
        scopes_json TEXT NOT NULL,
        resource TEXT,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS mcp_access_tokens (
        token_hash TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        scopes_json TEXT NOT NULL,
        resource TEXT,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS mcp_refresh_tokens (
        token_hash TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        scopes_json TEXT NOT NULL,
        resource TEXT,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
  }
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function stringValue(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Expected string value in token store.");
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number {
  if (typeof value !== "number") {
    throw new Error("Expected number value in token store.");
  }
  return value;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function parseJsonArray(value: unknown): string[] {
  if (typeof value !== "string") {
    return [];
  }
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
}

function parseJsonObject(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const parsed = JSON.parse(value) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
}
