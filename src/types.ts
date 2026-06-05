import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

export type Primitive = string | number | boolean;
export type QueryValue = Primitive | Primitive[] | null | undefined;
export type QueryParams = Record<string, QueryValue>;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type ResponseFormat = "markdown" | "json";
export const RESPONSE_FORMAT_VALUES = ["markdown", "json"] as const;

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface ChurchToolsRequest {
  method: HttpMethod;
  path: string;
  query?: QueryParams;
  body?: unknown;
}

export interface ChurchToolsRequestContext {
  authInfo?: AuthInfo;
}

export interface ChurchToolsRequester {
  request<T = unknown>(request: ChurchToolsRequest, context?: ChurchToolsRequestContext): Promise<T>;
}
