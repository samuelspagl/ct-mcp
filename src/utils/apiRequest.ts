import type { ChurchToolsRequest, ChurchToolsRequestContext, ChurchToolsRequester } from "../types.js";

export function requestChurchTools<T = unknown>(
  api: ChurchToolsRequester,
  request: ChurchToolsRequest,
  context: ChurchToolsRequestContext = {}
): Promise<T> {
  return context.authInfo ? api.request<T>(request, context) : api.request<T>(request);
}
