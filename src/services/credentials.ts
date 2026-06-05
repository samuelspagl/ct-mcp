import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

export const FORWARDED_CHURCHTOOLS_PAT_HEADER = "X-ChurchTools-PAT";
export const FORWARDED_CHURCHTOOLS_PAT_EXTRA_KEY = "churchToolsPat";

export interface ChurchToolsCredential {
  type: "login";
  token: string;
}

export interface ChurchToolsCredentialsProvider {
  getCredentials(authInfo?: AuthInfo): Promise<ChurchToolsCredential>;
}

export class StaticChurchToolsCredentialsProvider implements ChurchToolsCredentialsProvider {
  constructor(private readonly token: string) {}

  async getCredentials(): Promise<ChurchToolsCredential> {
    return {
      type: "login",
      token: this.token
    };
  }
}

export class ForwardedPatChurchToolsCredentialsProvider implements ChurchToolsCredentialsProvider {
  async getCredentials(authInfo?: AuthInfo): Promise<ChurchToolsCredential> {
    const token = getForwardedChurchToolsPat(authInfo);
    if (!token) {
      throw new Error(`Missing forwarded ChurchTools PAT. Send ${FORWARDED_CHURCHTOOLS_PAT_HEADER} with each MCP request.`);
    }

    return {
      type: "login",
      token
    };
  }
}

export function getForwardedChurchToolsPat(authInfo?: AuthInfo): string | undefined {
  const value = authInfo?.extra?.[FORWARDED_CHURCHTOOLS_PAT_EXTRA_KEY];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
