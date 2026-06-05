import churchToolsClientPackage from "@churchtools/churchtools-client";
import type { ChurchToolsClient as ChurchToolsClientInstance } from "@churchtools/churchtools-client";
import type { AxiosError, AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";
import { wrapper } from "axios-cookiejar-support";
import { CookieJar } from "tough-cookie";
import type { AppConfig } from "../config.js";
import type { ChurchToolsCredential, ChurchToolsCredentialsProvider } from "./credentials.js";
import type { ChurchToolsRequest, HttpMethod } from "../types.js";
import { appendQueryString } from "../utils/object.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

interface ChurchToolsClientInternals {
  ax?: AxiosInstance;
}

type ChurchToolsClientConstructor = new (
  churchToolsBaseUrl?: string,
  loginToken?: string,
  loadCSRFForOldApi?: boolean
) => ChurchToolsClientInstance;

const { ChurchToolsClient } = churchToolsClientPackage as unknown as {
  ChurchToolsClient: ChurchToolsClientConstructor;
};

export interface ChurchToolsApiDependencies {
  axios?: Pick<AxiosInstance, "request">;
  buildUrl?: (path: string) => string;
}

export class ChurchToolsApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = "ChurchToolsApiError";
  }
}

export class ChurchToolsApi {
  private readonly axios: Pick<AxiosInstance, "request">;
  private readonly buildUrl: (path: string) => string;

  constructor(
    private readonly config: Pick<AppConfig, "churchToolsBaseUrl" | "requestTimeoutMs">,
    private readonly credentialsProvider: ChurchToolsCredentialsProvider,
    dependencies: ChurchToolsApiDependencies = {}
  ) {
    if (dependencies.axios && dependencies.buildUrl) {
      this.axios = dependencies.axios;
      this.buildUrl = dependencies.buildUrl;
      return;
    }

    const client = new ChurchToolsClient(config.churchToolsBaseUrl);
    client.setBaseUrl(config.churchToolsBaseUrl);
    client.setRequestTimeout(config.requestTimeoutMs);
    client.setNeedsAuthentication(true);
    client.setCookieJar(wrapper, new CookieJar());

    const axiosInstance = (client as unknown as ChurchToolsClientInternals).ax;
    if (!axiosInstance) {
      throw new Error("Unable to access ChurchTools client transport.");
    }

    this.axios = axiosInstance;
    this.buildUrl = (path: string) => client.buildUrl(path);
  }

  async request<T = unknown>(request: ChurchToolsRequest, authInfo?: AuthInfo): Promise<T> {
    const url = appendQueryString(this.buildUrl(request.path), request.query);
    const credentials = await this.credentialsProvider.getCredentials(authInfo);
    const axiosConfig: AxiosRequestConfig = {
      method: request.method,
      url,
      timeout: this.config.requestTimeoutMs,
      headers: {
        Accept: "application/json",
        Authorization: createChurchToolsAuthorizationHeader(credentials),
        "Content-Type": "application/json",
        "X-OnlyAuthenticated": "1"
      }
    };

    if (request.method !== "GET" && request.body !== undefined) {
      axiosConfig.data = request.body;
    }

    try {
      const response = (await this.axios.request(axiosConfig)) as AxiosResponse<T>;
      return response.data;
    } catch (error) {
      throw normalizeChurchToolsApiError(error, request.method, request.path);
    }
  }
}

export function createChurchToolsAuthorizationHeader(credentials: ChurchToolsCredential | string): string {
  if (typeof credentials === "string") {
    return `Login ${credentials}`;
  }

  return credentials.type === "login" ? `Login ${credentials.token}` : `Bearer ${credentials.token}`;
}

function normalizeChurchToolsApiError(error: unknown, method: HttpMethod, path: string): ChurchToolsApiError {
  const axiosError = error as AxiosError<{ message?: string; error?: string }>;
  const status = axiosError.response?.status;
  const responseMessage = axiosError.response?.data?.message || axiosError.response?.data?.error;

  if (status) {
    const suffix = responseMessage ? `: ${responseMessage}` : "";
    return new ChurchToolsApiError(`ChurchTools API ${method} ${path} failed with status ${status}${suffix}`, status);
  }

  if (axiosError.code === "ECONNABORTED") {
    return new ChurchToolsApiError(`ChurchTools API ${method} ${path} timed out.`);
  }

  if (error instanceof Error) {
    return new ChurchToolsApiError(`ChurchTools API ${method} ${path} failed: ${error.message}`);
  }

  return new ChurchToolsApiError(`ChurchTools API ${method} ${path} failed.`);
}
