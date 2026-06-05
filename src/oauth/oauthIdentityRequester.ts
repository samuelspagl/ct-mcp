import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { ChurchToolsRequest, ChurchToolsRequester } from "../types.js";
import { OAuthTokenStore } from "./tokenStore.js";

export class OAuthIdentityRequester implements ChurchToolsRequester {
  constructor(private readonly store: OAuthTokenStore) {}

  async request<T = unknown>(request: ChurchToolsRequest, authInfo?: AuthInfo): Promise<T> {
    if (request.method === "GET" && request.path === "/whoami") {
      return this.getWhoami(authInfo) as T;
    }

    throw new Error(
      "ChurchTools OAuth access tokens are valid for OAuth endpoints such as /oauth/userinfo, but this ChurchTools REST API does not accept them for /api requests. Use CHURCHTOOLS_AUTH_MODE=pat for REST API tools, or add a per-user ChurchTools Login token flow."
    );
  }

  private getWhoami(authInfo?: AuthInfo): unknown {
    const userId = authInfo?.extra?.userId;
    if (typeof userId !== "string" || userId.length === 0) {
      throw new Error("OAuth whoami requires an authenticated user context.");
    }

    const tokens = this.store.getChurchToolsTokens(userId);
    if (!tokens?.profile) {
      throw new Error("No ChurchTools OAuth userinfo profile is stored for the authenticated user.");
    }

    return {
      data: {
        ...tokens.profile,
        authentication: {
          mode: "oauth",
          source: "/oauth/userinfo"
        }
      }
    };
  }
}
