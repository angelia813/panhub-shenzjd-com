import { BaseAsyncPlugin } from "../manager";
import type { SearchResult } from "../../types/models";
import { ofetch } from "ofetch";

type HunhepanItem = {
  disk_id: string;
  disk_name: string;
  disk_pass: string;
  disk_type: string;
  files: string;
  doc_id: string;
  share_user: string;
  shared_time: string; // "2025-07-07 13:19:48"
  link: string;
  enabled: boolean;
  weight: number;
  status: number;
};

type HunhepanResponse = {
  code: number;
  msg: string;
  data: {
    total: number;
    per_size: number;
    list: HunhepanItem[];
  };
};

const HUNHEPAN_API = "https://hunhepan.com/open/search/disk";
const QKPANSO_API = "https://qkpanso.com/v1/search/disk";
const KUAKE_API = "https://kuake8.com/v1/search/disk";
const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGES = 2; // 适度保守，避免过多请求

export class HunhepanPlugin extends BaseAsyncPlugin {
  constructor() {
    super("hunhepan", 3);
  }

  override async search(
    keyword: string,
    ext?: Record<string, any>
  ): Promise<SearchResult[]> {
    const timeout = Math.max(
      3000,
      Number((ext as any)?.__plugin_timeout_ms) || 10000
    );
    const allItems: HunhepanItem[] = [];
    const apis = [HUNHEPAN_API, QKPANSO_API, KUAKE_API];
    const tasks = apis.map((api) => this.searchApi(api, keyword));
    const results = await Promise.allSettled(tasks);
    for (const r of results) {
      if (r.status === "fulfilled" && Array.isArray(r.value)) {
        allItems.push(...r.value);
      }
    }
    const unique = this.deduplicate(allItems);
    return this.convertResults(unique);
  }

  private async searchApi(
    apiUrl: string,
    keyword: string
  ): Promise<HunhepanItem[]> {
    const pageTasks: Array<Promise<HunhepanItem[]>> = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const body = {
        q: keyword,
        exact: true,
        page,
        size: DEFAULT_PAGE_SIZE,
        type: "",
        time: "",
        from: "web",
        user_id: 0,
        filter: true,
      } as const;

      const headers: Record<string, string> = {
        "content-type": "application/json",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      };
      if (apiUrl.includes("qkpanso.com"))
        headers.referer = "https://qkpanso.com/search";
      else if (apiUrl.includes("kuake8.com"))
        headers.referer = "https://kuake8.com/search";
      else if (apiUrl.includes("hunhepan.com"))
        headers.referer = "https://hunhepan.com/search";

      pageTasks.push(
        ofetch<HunhepanResponse>(apiUrl, {
          method: "POST",
          body,
          headers,
          timeout: Math.max(3000, 10000),
        })
          .then((resp) => {
            if (!resp || resp.code !== 200) return [] as HunhepanItem[];
            return resp.data?.list || [];
          })
          .catch(() => [] as HunhepanItem[])
      );
    }

    const pages = await Promise.all(pageTasks);
    return pages.flat();
  }

  private deduplicate(items: HunhepanItem[]): HunhepanItem[] {
    const map = new Map<string, HunhepanItem>();
    for (const item of items) {
      const cleanedName = this.cleanTitle(item.disk_name);
      const clone: HunhepanItem = { ...item, disk_name: cleanedName };
      let key = "";
      if (clone.disk_id) key = clone.disk_id;
      else if (clone.link) key = `${clone.link}|${cleanedName}`;
      else key = `${cleanedName}|${clone.disk_type}`;

      if (!map.has(key)) {
        map.set(key, clone);
      } else {
        const existing = map.get(key)!;
        let existingScore = (existing.files || "").length;
        let newScore = (clone.files || "").length;
        if (!existing.disk_pass && clone.disk_pass) newScore += 5;
        if (!existing.shared_time && clone.shared_time) newScore += 3;
        if (newScore > existingScore) map.set(key, clone);
      }
    }
    return Array.from(map.values());
  }

  private convertResults(items: HunhepanItem[]): SearchResult[] {
    const out: SearchResult[] = [];
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      const linkType = this.convertDiskType(item.disk_type);
      const uniqueId = `hunhepan-${item.disk_id || i}`;
      const datetime = this.parseTime(item.shared_time);
      out.push({
        message_id: "",
        unique_id: uniqueId,
        channel: "",
        datetime,
        title: this.cleanTitle(item.disk_name),
        content: item.files,
        links: [
          {
            type: linkType,
            url: item.link,
            password: item.disk_pass || "",
          },
        ],
      });
    }
    return out;
  }

  private convertDiskType(diskType: string): string {
    switch (diskType) {
      case "BDY":
        return "baidu";
      case "ALY":
        return "aliyun";
      case "QUARK":
        return "quark";
      case "TIANYI":
        return "tianyi";
      case "UC":
        return "uc";
      case "CAIYUN":
        return "mobile";
      case "115":
        return "115";
      case "XUNLEI":
        return "xunlei";
      case "123PAN":
        return "123";
      case "PIKPAK":
        return "pikpak";
      default:
        return "others";
    }
  }

  private cleanTitle(title: string): string {
    const replacements: Record<string, string> = {
      "<em>": "",
      "</em>": "",
      "<b>": "",
      "</b>": "",
      "<strong>": "",
      "</strong>": "",
      "<i>": "",
      "</i>": "",
    };
    let result = title || "";
    for (const [tag, repl] of Object.entries(replacements)) {
      result = result.split(tag).join(repl);
    }
    return result.trim();
  }

  private parseTime(t: string): string {
    if (!t) return "";
    const iso = t.replace(" ", "T") + "Z";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toISOString();
  }
}
