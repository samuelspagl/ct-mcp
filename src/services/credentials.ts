import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

export type ChurchToolsCredential =
  | {
      type: "login";
      token: string;
    }
  | {
      type: "bearer";
      token: string;
    };

export interface ChurchToolsCredentialsProvider {
  getCredentials(authInfo?: AuthInfo): Promise<ChurchToolsCredential>;
}

export class PatChurchToolsCredentialsProvider implements ChurchToolsCredentialsProvider {
  constructor(private readonly token: string) {}

  async getCredentials(): Promise<ChurchToolsCredential> {
    return {
      type: "login",
      token: this.token
    };
  }
}
