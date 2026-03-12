import pLimit from "p-limit";
import { UnifiedCache, CacheNamespace } from "../cache/unifiedCache";
import { safeExecute } from "../utils/fetch";
import type { MergedLinks, SearchResponse, SearchResult } from "../types/models";
import { PluginManager, type AsyncSearchPlugin } from "../plugins/manager";
import {
  PluginHealthChecker,
  createPluginHealthChecker,
} from "../plugins/pluginHealth";
import {
  ErrorCollector,
  classifyError,
  type WarningInfo,
} from "../utils/errors";

export interface SearchServiceOptions {
  priorityChannels: string[];
  defaultChannels: string[];
  defaultConcurrency: number;
  pluginTimeoutMs: number;
  cacheEnabled: boolean;
  cacheTtlMinutes: number;
}

export class SearchService {
  private options: SearchServiceOptions;
  private pluginManager: PluginManager;
  private cache: UnifiedCache;
  private healthChecker: PluginHealthChecker;

  constructor(options: SearchServiceOptions, pluginManager: PluginManager) {
    this.options = options;
    this.pluginManager = pluginManager;
    this.cache = new UnifiedCache(
      {
        enabled: options.cacheEnabled,
        ttlMinutes: options.cacheTtlMinutes,
      },
      "search"
    );

    this.healthChecker = createPluginHealthChecker();
  }

  getPluginManager() {
    return this.pluginManager;
  }

  async search(
    keyword: string,
    channels: string[] | undefined,
    concurrency: number | undefined,
    forceRefresh: boolean | undefined,
    resultType: string | undefined,
    sourceType: "all" | "tg" | "plugin" | undefined,
    plugins: string[] | undefined,
    cloudTypes: string[] | undefined,
    ext: Record<string, any> | undefined
  ): Promise<SearchResponse> {
    const { response } = await this.searchWithWarnings(
      keyword,
      channels,
      concurrency,
      forceRefresh,
      resultType,
      sourceType,
      plugins,
      cloudTypes,
      ext
    );

    return response;
  }

  async searchWithWarnings(
    keyword: string,
    channels: string[] | undefined,
    concurrency: number | undefined,
    forceRefresh: boolean | undefined,
    resultType: string | undefined,
    sourceType: "all" | "tg" | "plugin" | undefined,
    plugins: string[] | undefined,
    cloudTypes: string[] | undefined,
    ext: Record<string, any> | undefined
  ): Promise<{ response: SearchResponse; warnings: WarningInfo[] }> {
    const errorCollector = new ErrorCollector();
    const effChannels =
      channels && channels.length > 0 ? channels : this.options.defaultChannels;
    const effConcurrency =
      concurrency && concurrency > 0
        ? concurrency
        : this.options.defaultConcurrency;
    const effResultType =
      !resultType || resultType === "merge" ? "merged_by_type" : resultType;
    const effSourceType = sourceType ?? "all";

    let tgResults: SearchResult[] = [];
    let pluginResults: SearchResult[] = [];

    const tasks: Array<() => Promise<void>> = [];

    if (effSourceType === "all" || effSourceType === "tg") {
      tasks.push(async () => {
        const concOverride =
          typeof concurrency === "number" && concurrency > 0
            ? concurrency
            : undefined;
        tgResults = await this.searchTG(
          keyword,
          effChannels,
          !!forceRefresh,
          concOverride,
          ext
        );
      });
    }
    if (effSourceType === "all" || effSourceType === "plugin") {
      tasks.push(async () => {
        pluginResults = await this.searchPlugins(
          keyword,
          plugins,
          !!forceRefresh,
          effConcurrency,
          ext ?? {},
          errorCollector
        );
      });
    }

    await Promise.all(tasks.map((t) => t()));

    const allResults = this.mergeSearchResults(tgResults, pluginResults);
    this.sortResultsByTimeDesc(allResults);

    const filteredForResults: SearchResult[] = [];
    for (const r of allResults) {
      const hasTime = !!r.datetime;
      const hasLinks = Array.isArray(r.links) && r.links.length > 0;
      const keywordPriority = this.getKeywordPriority(r.title);
      const pluginLevel = this.getPluginLevelBySource(this.getResultSource(r));
      if (hasTime || hasLinks || keywordPriority > 0 || pluginLevel <= 2) {
        filteredForResults.push(r);
      }
    }

    const mergedLinks = this.mergeResultsByType(
      allResults,
      keyword,
      cloudTypes
    );

    let total = 0;
    let response: SearchResponse = { total: 0 };
    if (effResultType === "merged_by_type") {
      total = Object.values(mergedLinks).reduce(
        (sum, arr) => sum + arr.length,
        0
      );
      response = { total, merged_by_type: mergedLinks };
    } else if (effResultType === "results") {
      total = filteredForResults.length;
      response = { total, results: filteredForResults };
    } else {
      total = filteredForResults.length;
      response = {
        total,
        results: filteredForResults,
        merged_by_type: mergedLinks,
      };
    }

    return {
      response,
      warnings: errorCollector.getWarnings(),
    };
  }

  private async searchTG(
    keyword: string,
    channels: string[] | undefined,
    forceRefresh: boolean,
    concurrencyOverride?: number,
    ext?: Record<string, any>
  ): Promise<SearchResult[]> {
    const chList = Array.isArray(channels) ? channels : [];
    const cacheKey = `tg:${keyword}:${[...chList].sort().join(",")}`;
    const { cacheEnabled, priorityChannels } = this.options;

    if (!forceRefresh && cacheEnabled) {
      const cached = this.cache.get(CacheNamespace.TG_SEARCH, cacheKey);
      if (cached.hit && cached.value) {
        return cached.value;
      }
    }

    const { fetchTgChannelPosts } = await import("./tg");
    const perChannelLimit = 30;
    const requestedTimeout = Number((ext as any)?.__plugin_timeout_ms) || 0;
    const timeoutMs = Math.max(
      3000,
      requestedTimeout > 0
        ? requestedTimeout
        : this.options.pluginTimeoutMs || 0
    );
    const concurrency = Math.max(
      2,
      Math.min(concurrencyOverride ?? this.options.defaultConcurrency, 12)
    );

    const prioritySet = new Set(priorityChannels || []);
    const priorityList = chList.filter((ch) => prioritySet.has(ch));
    const normalList = chList.filter((ch) => !prioritySet.has(ch));

    const createChannelTask = (channel: string) => async () => {
      const result = await safeExecute(
        () =>
          this.withTimeout<SearchResult[]>(
            fetchTgChannelPosts(channel, keyword, {
              limitPerChannel: perChannelLimit,
            }),
            timeoutMs,
            []
          ),
        []
      );
      return result;
    };

    const allTasks = [...priorityList, ...normalList].map(createChannelTask);
    const allResults = await this.runWithConcurrency(allTasks, concurrency);

    const results: SearchResult[] = [];
    for (const arr of allResults) {
      if (Array.isArray(arr)) {
        results.push(...arr);
      }
    }

    if (cacheEnabled && results.length > 0) {
      this.cache.set(CacheNamespace.TG_SEARCH, cacheKey, results);
    }

    return results;
  }

  private async searchPlugins(
    keyword: string,
    plugins: string[] | undefined,
    forceRefresh: boolean,
    concurrency: number,
    ext: Record<string, any>,
    errorCollector: ErrorCollector
  ): Promise<SearchResult[]> {
    const cacheKey = `plugin:${keyword}:${(plugins ?? [])
      .map((p) => p?.toLowerCase())
      .filter(Boolean)
      .sort()
      .join(",")}`;
    const { cacheEnabled } = this.options;

    if (!forceRefresh && cacheEnabled) {
      const cached = this.cache.get(CacheNamespace.PLUGIN_SEARCH, cacheKey);
      if (cached.hit && cached.value) {
        return cached.value;
      }
    }

    const allPlugins = this.pluginManager.getPlugins();
    const healthyPlugins = allPlugins.filter((p) =>
      this.healthChecker.isHealthy(p.name())
    );

    let available: AsyncSearchPlugin[] = [];
    if (plugins && plugins.length > 0 && plugins.some((p) => !!p)) {
      const wanted = new Set(plugins.map((p) => p.toLowerCase()));
      available = healthyPlugins.filter((p) =>
        wanted.has(p.name().toLowerCase())
      );
    } else {
      available = healthyPlugins;
    }

    const requestedTimeout = Number((ext as any)?.__plugin_timeout_ms) || 0;
    const timeoutMs = Math.max(
      3000,
      requestedTimeout > 0
        ? requestedTimeout
        : this.options.pluginTimeoutMs || 0
    );

    const pluginPromises = available.map((p) => async () => {
      p.setMainCacheKey(cacheKey);
      p.setCurrentKeyword(keyword);

      const startTime = Date.now();
      const pluginName = p.name();

      let results = await this.withTimeout<SearchResult[]>(
        p.search(keyword, ext),
        timeoutMs,
        []
      );

      if ((!results || results.length === 0) && (keyword || "").trim().length <= 1) {
        const fallbacks = ["电影", "movie", "1080p"];
        for (const fb of fallbacks) {
          const fallbackResults = await this.withTimeout<SearchResult[]>(
            p.search(fb, ext),
            timeoutMs,
            []
          );
          if (fallbackResults && fallbackResults.length > 0) {
            results = fallbackResults;
            break;
          }
        }
      }

      const responseTime = Date.now() - startTime;
      this.healthChecker.recordSuccess(pluginName, responseTime);

      return results || [];
    });

    const resultsByPlugin = await this.runWithConcurrency(
      pluginPromises.map((promiseFactory) => async () => {
        try {
          return await promiseFactory();
        } catch (error) {
          const errorDetail = classifyError(error, "plugin_search");
          errorCollector.record(errorDetail);
          return [];
        }
      }),
      concurrency
    );

    const merged: SearchResult[] = [];
    for (const arr of resultsByPlugin) {
      if (Array.isArray(arr)) {
        merged.push(...arr);
      }
    }

    if (cacheEnabled && merged.length > 0) {
      this.cache.set(CacheNamespace.PLUGIN_SEARCH, cacheKey, merged);
    }

    return merged;
  }

  private withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    fallback: T
  ): Promise<T> {
    if (!ms || ms <= 0) return promise;
    let timeoutHandle: any;
    const timeoutPromise = new Promise<T>((resolve) => {
      timeoutHandle = setTimeout(() => resolve(fallback), ms);
    });
    return Promise.race([
      promise.finally(() => clearTimeout(timeoutHandle)),
      timeoutPromise,
    ]) as Promise<T>;
  }

  private mergeSearchResults(
    a: SearchResult[],
    b: SearchResult[]
  ): SearchResult[] {
    const seen = new Set<string>();
    const out: SearchResult[] = [];
    const pushUnique = (r: SearchResult) => {
      const key = r.unique_id || r.message_id || `${r.title}|${r.channel}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push(r);
    };
    for (const r of a) pushUnique(r);
    for (const r of b) pushUnique(r);
    return out;
  }

  private sortResultsByTimeDesc(arr: SearchResult[]) {
    arr.sort(
      (x, y) => new Date(y.datetime).getTime() - new Date(x.datetime).getTime()
    );
  }

  private getResultSource(_r: SearchResult): string {
    return "";
  }

  private getPluginLevelBySource(_source: string): number {
    return 3;
  }

  private getKeywordPriority(_title: string): number {
    return 0;
  }

  private mergeResultsByType(
    results: SearchResult[],
    _keyword: string,
    cloudTypes?: string[]
  ): MergedLinks {
    const allow =
      cloudTypes && cloudTypes.length > 0
        ? new Set(cloudTypes.map((s) => s.toLowerCase()))
        : undefined;
    const out: MergedLinks = {};
    for (const r of results) {
      for (const link of r.links || []) {
        const t = (link.type || "").toLowerCase();
        if (allow && !allow.has(t)) continue;
        if (!out[t]) out[t] = [];
        out[t].push({
          url: link.url,
          password: link.password,
          note: r.title,
          datetime: r.datetime,
          images: r.images,
        });
      }
    }
    return out;
  }

  private async runWithConcurrency<T>(
    tasks: Array<() => Promise<T>>,
    limit: number
  ): Promise<T[]> {
    const limitFn = pLimit(limit);
    const limitedTasks = tasks.map((task) => limitFn(task));
    return Promise.all(limitedTasks);
  }

  getCacheStats() {
    return this.cache.getStats();
  }

  clearCache(namespace?: CacheNamespace) {
    if (namespace) {
      this.cache.clearNamespace(namespace);
    } else {
      this.cache.clearAll();
    }
  }

  getPluginHealthStatus() {
    return this.healthChecker.getAllStatus();
  }

  resetPluginHealth(pluginName?: string) {
    if (pluginName) {
      this.healthChecker.reset(pluginName);
    } else {
      this.healthChecker.resetAll();
    }
  }
}
