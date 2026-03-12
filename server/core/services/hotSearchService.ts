import type { IHotSearchStore, HotSearchItem, HotSearchStats } from "./hotSearchStore";
import { JsonFileHotSearchStore } from "./jsonFileHotSearchStore";
import { MemoryHotSearchStore } from "./memoryHotSearchStore";

// 模块级共享内存存储：确保同一进程内所有降级到内存的情况使用同一实例
// 解决 service 重建时数据丢失问题（本地开发）
let sharedMemoryStore: MemoryHotSearchStore | null = null;

function getOrCreateSharedMemoryStore(): MemoryHotSearchStore {
  if (!sharedMemoryStore) {
    sharedMemoryStore = new MemoryHotSearchStore();
  }
  return sharedMemoryStore;
}

/**
 * 热搜服务
 * 根据环境自动选择 JSON 文件或内存存储
 */
export class HotSearchService {
  private store: IHotSearchStore;
  private storeType: "json" | "memory";
  private initPromise: Promise<void> | null = null;

  constructor() {
    // 尝试初始化 JSON 文件存储
    const jsonStore = new JsonFileHotSearchStore();
    this.store = jsonStore;
    this.storeType = "json";

    // 异步初始化，如果失败则降级到内存存储
    this.initPromise = this.initializeWithFallback();
  }

  private async initializeWithFallback(): Promise<void> {
    try {
      // 等待 JSON 文件存储初始化
      await (this.store as JsonFileHotSearchStore)["waitForInit"]?.();
      console.log("[HotSearchService] ✅ 使用 JSON 文件存储模式");
    } catch {
      console.log("[HotSearchService] ⚠️ JSON 文件初始化失败，降级到内存模式");
      // 降级到共享内存存储（同一进程内复用，避免 service 重建导致数据丢失）
      this.store = getOrCreateSharedMemoryStore();
      this.storeType = "memory";
    }
  }

  private async waitForInit(): Promise<void> {
    if (this.initPromise) {
      await this.initPromise;
      this.initPromise = null;
    }
  }

  async recordSearch(term: string): Promise<void> {
    await this.waitForInit();
    const now = Date.now();
    await this.store.recordSearch(term, now);
  }

  async getHotSearches(limit: number = 30): Promise<HotSearchItem[]> {
    await this.waitForInit();
    return this.store.getHotSearches(limit);
  }

  async clearHotSearches(): Promise<{ success: boolean; message: string }> {
    await this.waitForInit();
    return this.store.clearHotSearches();
  }

  async deleteHotSearch(term: string): Promise<{ success: boolean; message: string }> {
    await this.waitForInit();
    return this.store.deleteHotSearch(term);
  }

  async getStats(): Promise<{ total: number; topTerms: HotSearchItem[]; mode: string }> {
    await this.waitForInit();
    const stats = await this.store.getStats();
    return {
      ...stats,
      mode: this.storeType,
    };
  }

  getDatabaseSize(): number {
    if (this.storeType === "json" && this.store instanceof JsonFileHotSearchStore) {
      return this.store.getFileSize();
    }
    return 0;
  }

  getStoreType(): "json" | "memory" {
    return this.storeType;
  }

  close(): void {
    this.store.close();
  }
}

// 单例模式
const HOT_SEARCH_SERVICE_KEY = "__panhub_hot_search_service_v2__";

export function getOrCreateHotSearchService(): HotSearchService {
  const context = (globalThis as any)[HOT_SEARCH_SERVICE_KEY];
  if (context?.service) {
    return context.service;
  }

  const service = new HotSearchService();
  (globalThis as any)[HOT_SEARCH_SERVICE_KEY] = { service };
  return service;
}

export function resetHotSearchService(): void {
  const context = (globalThis as any)[HOT_SEARCH_SERVICE_KEY];
  if (context?.service) {
    context.service.close();
  }
  delete (globalThis as any)[HOT_SEARCH_SERVICE_KEY];
  // 不重置 sharedMemoryStore，保持内存数据（用于测试时需单独清理）
}

// 向后兼容：导出旧的类型别名
export type { HotSearchItem, HotSearchStats };
