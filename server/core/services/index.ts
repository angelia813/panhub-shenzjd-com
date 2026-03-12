import { SearchService, type SearchServiceOptions } from "./searchService";
import { PluginManager, registerGlobalPlugin } from "../plugins/manager";
import { HunhepanPlugin } from "../plugins/example/hunhepan";
// import { ZhizhenPlugin } from "../plugins/zhizhen";
// import { OugePlugin } from "../plugins/ouge";
// import { WanouPlugin } from "../plugins/wanou";
import { LabiPlugin } from "../plugins/labi";
import { PantaPlugin } from "../plugins/panta";
// import { SusuPlugin } from "../plugins/susu";
import { JikepanPlugin } from "../plugins/jikepan";
import { QupansouPlugin } from "../plugins/qupansou";
// import { Fox4kPlugin } from "../plugins/fox4k";
// import { Hdr4kPlugin } from "../plugins/hdr4k";
import { ThePirateBayPlugin } from "../plugins/thepiratebay";
import { DuoduoPlugin } from "../plugins/duoduo";
// import { MuouPlugin } from "../plugins/muou";
// import { Pan666Plugin } from "../plugins/pan666";
import { XuexizhinanPlugin } from "../plugins/xuexizhinan";
// import { HubanPlugin } from "../plugins/huban";
// import { PanyqPlugin } from "../plugins/panyq";
import { PansearchPlugin } from "../plugins/pansearch";
// import { ShandianPlugin } from "../plugins/shandian";
import { NyaaPlugin } from "../plugins/nyaa";
// import { SolidTorrentsPlugin } from "../plugins/solidtorrents";
// import { X1337xPlugin } from "../plugins/x1337x";
// import { TorrentGalaxyPlugin } from "../plugins/torrentgalaxy";

const SERVICE_CONTEXT_KEY = "__panhub_search_service__";

/**
 * 创建插件管理器并注册所有可用插件
 */
function createPluginManager(): PluginManager {
  const pm = new PluginManager();
  // 直接注册内置插件（避免使用 Nitro 插件 impound 机制）
  // 仅注册稳定可用的插件；其余暂时禁用，待适配后再启用
  registerGlobalPlugin(new HunhepanPlugin());
  // zhizhen 暂时下线，待稳定后再恢复
  registerGlobalPlugin(new LabiPlugin());
  registerGlobalPlugin(new PantaPlugin());
  registerGlobalPlugin(new JikepanPlugin());
  registerGlobalPlugin(new QupansouPlugin());
  registerGlobalPlugin(new ThePirateBayPlugin());
  registerGlobalPlugin(new DuoduoPlugin());
  registerGlobalPlugin(new XuexizhinanPlugin());
  registerGlobalPlugin(new PansearchPlugin());
  registerGlobalPlugin(new NyaaPlugin());
  // 下线未通过单测的插件，待后续适配稳定后再恢复：
  // Zhizhen, Ouge, Wanou, Susu, Fox4k, Hdr4k, Muou, Pan666, Huban, Panyq, Shandian, SolidTorrents, 1337x, TorrentGalaxy
  pm.registerAllGlobalPlugins();
  return pm;
}

/**
 * 创建搜索服务选项
 */
function createServiceOptions(runtimeConfig: any): SearchServiceOptions {
  return {
    priorityChannels: runtimeConfig.priorityChannels || [],
    defaultChannels: runtimeConfig.defaultChannels || [],
    defaultConcurrency: runtimeConfig.defaultConcurrency || 10,
    pluginTimeoutMs: runtimeConfig.pluginTimeoutMs || 15000,
    cacheEnabled: !!runtimeConfig.cacheEnabled,
    cacheTtlMinutes: runtimeConfig.cacheTtlMinutes || 30,
  };
}

/**
 * 获取或创建搜索服务实例
 * 使用 Nitro 上下文存储，支持测试时重置
 */
export function getOrCreateSearchService(runtimeConfig: any): SearchService {
  // 尝试从 Nitro 上下文获取
  const context = (globalThis as any)[SERVICE_CONTEXT_KEY];
  if (context?.service) {
    return context.service;
  }

  // 创建新实例
  const options = createServiceOptions(runtimeConfig);
  const pluginManager = createPluginManager();
  const service = new SearchService(options, pluginManager);

  // 存储到上下文
  (globalThis as any)[SERVICE_CONTEXT_KEY] = { service, options, pluginManager };
  return service;
}

/**
 * 重置搜索服务实例（仅用于测试）
 */
export function resetSearchService(): void {
  delete (globalThis as any)[SERVICE_CONTEXT_KEY];
}

/**
 * 获取搜索服务统计信息（用于监控）
 */
export function getSearchServiceStats(): { exists: boolean; options?: SearchServiceOptions } {
  const context = (globalThis as any)[SERVICE_CONTEXT_KEY];
  if (!context) {
    return { exists: false };
  }
  return {
    exists: true,
    options: context.options,
  };
}
