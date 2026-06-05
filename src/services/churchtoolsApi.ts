import churchToolsClientPackage from "@churchtools/churchtools-client";
import type { ChurchToolsClient as ChurchToolsClientInstance } from "@churchtools/churchtools-client";
import type { AxiosError, AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";
import { wrapper } from "axios-cookiejar-support";
import { CookieJar } from "tough-cookie";
import type { AppConfig } from "../config.js";
import type { ChurchToolsRequest, ChurchToolsRequestContext, HttpMethod } from "../types.js";
import { appendQueryString } from "../utils/object.js";
import { StaticChurchToolsCredentialsProvider, type ChurchToolsCredentialsProvider } from "./credentials.js";

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
  private readonly credentialsProvider: ChurchToolsCredentialsProvider;

  constructor(
    private readonly config: Pick<AppConfig, "churchToolsBaseUrl" | "churchToolsPat" | "requestTimeoutMs">,
    credentialsProviderOrDependencies: ChurchToolsCredentialsProvider | ChurchToolsApiDependencies = new StaticChurchToolsCredentialsProvider(
      requiredStaticPat(config.churchToolsPat)
    ),
    dependencies: ChurchToolsApiDependencies = {}
  ) {
    const resolvedDependencies = isCredentialsProvider(credentialsProviderOrDependencies)
      ? dependencies
      : credentialsProviderOrDependencies;
    this.credentialsProvider = isCredentialsProvider(credentialsProviderOrDependencies)
      ? credentialsProviderOrDependencies
      : new StaticChurchToolsCredentialsProvider(requiredStaticPat(config.churchToolsPat));

    if (resolvedDependencies.axios && resolvedDependencies.buildUrl) {
      this.axios = resolvedDependencies.axios;
      this.buildUrl = resolvedDependencies.buildUrl;
      return;
    }

    const client = new ChurchToolsClient(config.churchToolsBaseUrl, config.churchToolsPat);
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

  async request<T = unknown>(request: ChurchToolsRequest, context: ChurchToolsRequestContext = {}): Promise<T> {
    const url = appendQueryString(this.buildUrl(request.path), request.query);
    const credentials = await this.credentialsProvider.getCredentials(context.authInfo);
    const axiosConfig: AxiosRequestConfig = {
      method: request.method,
      url,
      timeout: this.config.requestTimeoutMs,
      headers: {
        Accept: "application/json",
        Authorization: createChurchToolsAuthorizationHeader(credentials.token),
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

export function createChurchToolsAuthorizationHeader(token: string): string {
  return `Login ${token}`;
}

function isCredentialsProvider(value: ChurchToolsCredentialsProvider | ChurchToolsApiDependencies): value is ChurchToolsCredentialsProvider {
  return "getCredentials" in value && typeof value.getCredentials === "function";
}

function requiredStaticPat(token: string | undefined): string {
  if (!token) {
    throw new Error("Static ChurchTools PAT is required for this credentials provider.");
  }
  return token;
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
