import { describe, expect, it } from "vitest";
import { SearchService } from "../../server/core/services/searchService";
import {
  BaseAsyncPlugin,
  PluginManager,
} from "../../server/core/plugins/manager";
import type { SearchResult } from "../../server/core/types/models";

class ThrowingPlugin extends BaseAsyncPlugin {
  async search(): Promise<SearchResult[]> {
    throw new Error("plugin exploded");
  }
}

class SuccessPlugin extends BaseAsyncPlugin {
  async search(): Promise<SearchResult[]> {
    return [
      {
        message_id: "1",
        unique_id: "ok-1",
        channel: "success-plugin",
        datetime: new Date("2026-01-01T00:00:00.000Z").toISOString(),
        title: "ok result",
        content: "ok result",
        links: [{ type: "quark", url: "https://example.com/1", password: "" }],
      },
    ];
  }
}

class EmptyPlugin extends BaseAsyncPlugin {
  async search(): Promise<SearchResult[]> {
    return [];
  }
}

class FallbackPlugin extends BaseAsyncPlugin {
  async search(keyword: string): Promise<SearchResult[]> {
    if (keyword === "movie") {
      return [
        {
          message_id: "fallback-1",
          unique_id: "fallback-1",
          channel: "fallback-plugin",
          datetime: new Date("2026-01-01T00:00:00.000Z").toISOString(),
          title: "fallback result",
          content: "fallback result",
          links: [{ type: "quark", url: "https://example.com/fallback", password: "" }],
        },
      ];
    }

    return [];
  }
}

function createService(plugin: BaseAsyncPlugin) {
  const manager = new PluginManager();
  manager.registerPlugin(plugin);

  return new SearchService(
    {
      priorityChannels: [],
      defaultChannels: [],
      defaultConcurrency: 2,
      pluginTimeoutMs: 100,
      cacheEnabled: false,
      cacheTtlMinutes: 1,
    },
    manager
  );
}

function createServiceWithPlugins(plugins: BaseAsyncPlugin[]) {
  const manager = new PluginManager();
  for (const plugin of plugins) {
    manager.registerPlugin(plugin);
  }

  return new SearchService(
    {
      priorityChannels: [],
      defaultChannels: [],
      defaultConcurrency: 2,
      pluginTimeoutMs: 100,
      cacheEnabled: false,
      cacheTtlMinutes: 1,
    },
    manager
  );
}

describe("SearchService warnings", () => {
  it("returns warnings for the current failed search", async () => {
    const service = createService(new ThrowingPlugin("thrower", 1));

    const result = await service.searchWithWarnings(
      "test",
      [],
      1,
      false,
      "merged_by_type",
      "plugin",
      ["thrower"],
      undefined,
      {}
    );

    expect(result.response.total).toBe(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.source).toBe("plugin_search");
  });

  it("does not leak warnings into the next successful search", async () => {
    const service = createServiceWithPlugins([
      new ThrowingPlugin("thrower", 1),
      new SuccessPlugin("success", 1),
    ]);

    await service.searchWithWarnings(
      "test",
      [],
      1,
      false,
      "merged_by_type",
      "plugin",
      ["thrower"],
      undefined,
      {}
    );

    const result = await service.searchWithWarnings(
      "test",
      [],
      1,
      false,
      "merged_by_type",
      "plugin",
      ["success"],
      undefined,
      {}
    );

    expect(result.response.total).toBe(1);
    expect(result.warnings).toEqual([]);
  });

  it("does not mark a plugin unhealthy when it simply returns no results", async () => {
    const service = createService(new EmptyPlugin("empty", 1));

    for (let i = 0; i < 6; i++) {
      const result = await service.searchWithWarnings(
        `miss-${i}`,
        [],
        1,
        false,
        "merged_by_type",
        "plugin",
        ["empty"],
        undefined,
        {}
      );

      expect(result.response.total).toBe(0);
    }

    const status = service.getPluginHealthStatus().find((item) => item.name === "empty");
    expect(status?.isHealthy).toBe(true);
    expect(status?.failureCount).toBe(0);
  });

  it("does not count a successful fallback search as a plugin failure", async () => {
    const service = createService(new FallbackPlugin("fallback", 1));

    const result = await service.searchWithWarnings(
      "a",
      [],
      1,
      false,
      "merged_by_type",
      "plugin",
      ["fallback"],
      undefined,
      {}
    );

    expect(result.response.total).toBe(1);

    const status = service.getPluginHealthStatus().find((item) => item.name === "fallback");
    expect(status?.isHealthy).toBe(true);
    expect(status?.failureCount).toBe(0);
    expect(status?.successCount).toBe(1);
  });
});
