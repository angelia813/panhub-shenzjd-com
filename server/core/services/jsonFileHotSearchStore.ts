import { mkdirSync, existsSync, statSync, readFileSync, writeFileSync } from "fs";
import type { IHotSearchStore, HotSearchItem, HotSearchStats } from "./hotSearchStore";

const MAX_ENTRIES = 30;
const DB_DIR = "./data";
const FILE_PATH = "./data/hot-searches.json";

function isForbidden(term: string): boolean {
  const forbiddenPatterns = [
    /政治|暴力|色情|赌博|毒品/i,
    /fuck|shit|bitch/i,
  ];
  return forbiddenPatterns.some((pattern) => pattern.test(term));
}

function loadItems(): Record<string, HotSearchItem> {
  try {
    if (!existsSync(FILE_PATH)) return {};
    const raw = readFileSync(FILE_PATH, "utf-8");
    const data = JSON.parse(raw);
    if (data && typeof data === "object" && Array.isArray(data.items)) {
      const map: Record<string, HotSearchItem> = {};
      for (const item of data.items) {
        if (item?.term) {
          map[item.term] = {
            term: item.term,
            score: Number(item.score) || 1,
            lastSearched: Number(item.lastSearched) || 0,
            createdAt: Number(item.createdAt) || 0,
          };
        }
      }
      return map;
    }
    return {};
  } catch {
    return {};
  }
}

function saveItems(map: Record<string, HotSearchItem>): void {
  const items = Object.values(map).sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.lastSearched - a.lastSearched;
  });
  const data = { items, updatedAt: Date.now() };
  writeFileSync(FILE_PATH, JSON.stringify(data, null, 2), "utf-8");
}

/**
 * JSON 文件热搜存储实现
 * 使用 JSON 文件持久化，无需 native 依赖
 */
export class JsonFileHotSearchStore implements IHotSearchStore {
  private initPromise: Promise<void> | null = null;
  private isInitialized = false;
  private initFailed = false;

  constructor() {
    this.initPromise = this.init()
      .then(() => {
        this.isInitialized = true;
        this.initPromise = null;
      })
      .catch((err) => {
        console.log("[JsonFileHotSearchStore] ❌ 初始化失败:", err instanceof Error ? err.message : err);
        this.initFailed = true;
        this.initPromise = null;
        throw err;
      });
  }

  private async init(): Promise<void> {
    try {
      if (!existsSync(DB_DIR)) {
        mkdirSync(DB_DIR, { recursive: true });
        console.log(`[JsonFileHotSearchStore] ✅ 创建数据目录: ${DB_DIR}`);
      }
      if (!existsSync(FILE_PATH)) {
        saveItems({});
      } else {
        loadItems();
      }
      console.log("[JsonFileHotSearchStore] ✅ JSON 文件存储已初始化");
    } catch (error) {
      throw error;
    }
  }

  private async waitForInit(): Promise<void> {
    if (this.isInitialized) return;
    if (this.initFailed) return;
    if (this.initPromise) await this.initPromise;
  }

  async recordSearch(term: string, now: number): Promise<void> {
    await this.waitForInit();
    if (!term || term.trim().length === 0) return;
    if (isForbidden(term)) {
      console.log(`[JsonFileHotSearchStore] 违规词被过滤: ${term}`);
      return;
    }

    try {
      const map = loadItems();
      const existing = map[term];
      if (existing) {
        existing.score += 1;
        existing.lastSearched = now;
      } else {
        map[term] = { term, score: 1, lastSearched: now, createdAt: now };
      }
      saveItems(map);
      await this.cleanupOldEntries(MAX_ENTRIES);
      console.log(`[JsonFileHotSearchStore] ✅ 记录搜索词: "${term}"`);
    } catch (error) {
      console.log(`[JsonFileHotSearchStore] ❌ 记录搜索词失败:`, error instanceof Error ? error.message : error);
    }
  }

  async getHotSearches(limit: number): Promise<HotSearchItem[]> {
    await this.waitForInit();
    try {
      const map = loadItems();
      return Object.values(map)
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          return b.lastSearched - a.lastSearched;
        })
        .slice(0, Math.min(limit, MAX_ENTRIES));
    } catch {
      return [];
    }
  }

  async cleanupOldEntries(maxEntries: number): Promise<void> {
    try {
      const map = loadItems();
      const entries = Object.entries(map).sort((a, b) => {
        if (b[1].score !== a[1].score) return b[1].score - a[1].score;
        return b[1].lastSearched - a[1].lastSearched;
      });
      if (entries.length > maxEntries) {
        entries.slice(maxEntries).forEach(([term]) => delete map[term]);
        saveItems(map);
      }
    } catch {
      // ignore
    }
  }

  async clearHotSearches(): Promise<{ success: boolean; message: string }> {
    await this.waitForInit();
    try {
      saveItems({});
      return { success: true, message: "热搜记录已清除" };
    } catch {
      return { success: false, message: "清除失败" };
    }
  }

  async deleteHotSearch(term: string): Promise<{ success: boolean; message: string }> {
    await this.waitForInit();
    try {
      const map = loadItems();
      if (term in map) {
        delete map[term];
        saveItems(map);
        return { success: true, message: `热搜词 "${term}" 已删除` };
      }
      return { success: false, message: "热搜词不存在" };
    } catch {
      return { success: false, message: "删除失败" };
    }
  }

  async getStats(): Promise<HotSearchStats> {
    const items = await this.getHotSearches(10);
    const all = await this.getHotSearches(MAX_ENTRIES);
    return { total: all.length, topTerms: items };
  }

  getFileSize(): number {
    try {
      if (existsSync(FILE_PATH)) {
        const stats = statSync(FILE_PATH);
        return Math.round((stats.size / (1024 * 1024)) * 100) / 100;
      }
      return 0;
    } catch {
      return 0;
    }
  }

  close(): void {
    // no-op for JSON file
  }
}
