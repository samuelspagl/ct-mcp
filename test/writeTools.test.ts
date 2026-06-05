import { describe, expect, it, vi } from "vitest";
import type { ChurchToolsRequest } from "../src/types.js";
import { runUpdateEvent, runUpdateSong, runUpdateWikiCategory } from "../src/tools/writeTools.js";
import { testConfig } from "./helpers.js";

function mockApi(resolver: (request: ChurchToolsRequest) => unknown) {
  return {
    request: vi.fn(async (request: ChurchToolsRequest) => resolver(request))
  };
}

describe("write tools", () => {
  it("requires confirmation before updating an event", async () => {
    const api = mockApi(() => ({ data: {} }));

    const result = await runUpdateEvent(api, { eventId: 1, note: "Updated", response_format: "json" }, testConfig);

    expect(result.structuredContent?.status).toBe("confirmation_required");
    expect(api.request).not.toHaveBeenCalled();
  });

  it("updates an event after fallback confirmation", async () => {
    const api = mockApi(() => ({ data: { id: 1 } }));

    const result = await runUpdateEvent(
      api,
      { eventId: 1, note: "Updated", confirm: true, response_format: "json" },
      testConfig
    );

    expect(result.isError).toBeUndefined();
    expect(api.request).toHaveBeenCalledWith(
      {
        method: "PUT",
        path: "/events/1",
        body: { note: "Updated" }
      },
      undefined
    );
  });

  it("supports tag-only song updates by preserving current required PUT fields", async () => {
    const api = mockApi((request) => {
      if (request.method === "GET") {
        return { data: { id: 7, name: "Existing Song", categoryId: 2 } };
      }
      return { data: { id: 7 } };
    });

    const result = await runUpdateSong(
      api,
      { songId: 7, tags: ["Worship"], confirm: true, response_format: "json" },
      testConfig
    );

    expect(result.isError).toBeUndefined();
    expect(api.request).toHaveBeenLastCalledWith(
      {
        method: "PUT",
        path: "/songs/7",
        body: { name: "Existing Song", categoryId: 2, tags: ["Worship"] }
      },
      undefined
    );
  });

  it("updates wiki categories while preserving required PUT fields", async () => {
    const api = mockApi((request) => {
      if (request.method === "GET") {
        return {
          data: [
            {
              id: 3,
              name: "Docs",
              sortKey: 10,
              inMenu: true,
              fileAccessWithoutPermission: false,
              campusId: null
            }
          ]
        };
      }
      return { data: { id: 3 } };
    });

    const result = await runUpdateWikiCategory(
      api,
      { wikiCategoryId: 3, name: "Documentation", confirm: true, response_format: "json" },
      testConfig
    );

    expect(result.isError).toBeUndefined();
    expect(api.request).toHaveBeenLastCalledWith(
      {
        method: "PUT",
        path: "/wiki/categories/3",
        body: {
          name: "Documentation",
          sortKey: 10,
          inMenu: true,
          fileAccessWithoutPermission: false,
          campusId: null
        }
      },
      undefined
    );
  });
});
