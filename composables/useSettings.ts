import type { Ref } from "vue";
import {
  ALL_PLUGIN_NAMES,
  DEFAULT_USER_SETTINGS,
  STORAGE_KEYS,
} from "~/config/plugins";
import channelsConfig from "~/config/channels.json";

export interface UserSettings {
  enabledTgChannels: string[];
  enabledPlugins: string[];
  concurrency: number;
  pluginTimeoutMs: number;
}

export interface UseSettingsReturn {
  settings: Ref<UserSettings>;
  loadSettings: () => void;
  saveSettings: () => void;
  resetToDefault: () => void;
  onSelectAll: () => void;
  onClearAll: () => void;
  onSelectAllTg: () => void;
  onClearAllTg: () => void;
}

// 模块级单例：确保 app.vue、index.vue、SettingsDrawer 等共用同一份 settings
let settingsSingleton: ReturnType<typeof ref<UserSettings>> | null = null;

export function useSettings(): UseSettingsReturn {
  const config = useRuntimeConfig();

  // 获取默认频道（优先使用配置文件，fallback 到运行时配置）
  const defaultTgChannels = computed(() => {
    const configChannels = (config.public as any)?.tgDefaultChannels;
    if (Array.isArray(configChannels) && configChannels.length > 0) {
      return configChannels;
    }
    return channelsConfig.defaultChannels;
  });

  // 单例 settings：全应用共享，设置修改后搜索能立即用到最新配置
  if (!settingsSingleton) {
    settingsSingleton = ref<UserSettings>({
    enabledTgChannels: [
      ...(defaultTgChannels.value?.length
        ? defaultTgChannels.value
        : channelsConfig.defaultChannels),
    ],
    enabledPlugins: [...DEFAULT_USER_SETTINGS.enabledPlugins],
    concurrency: DEFAULT_USER_SETTINGS.concurrency,
    pluginTimeoutMs: DEFAULT_USER_SETTINGS.pluginTimeoutMs,
  });
  }
  const settings = settingsSingleton;

  // 加载设置
  function loadSettings(): void {
    if (typeof window === "undefined") return;

    try {
      const raw = localStorage.getItem(STORAGE_KEYS.settings);
      if (!raw) return;

      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return;

      const validated: UserSettings = {
        enabledTgChannels: Array.isArray(parsed.enabledTgChannels)
          ? parsed.enabledTgChannels.filter((x: unknown) => typeof x === "string")
          : [...(defaultTgChannels.value?.length ? defaultTgChannels.value : channelsConfig.defaultChannels)],
        enabledPlugins: Array.isArray(parsed.enabledPlugins)
          ? parsed.enabledPlugins.filter((x: unknown) => typeof x === "string")
          : [...DEFAULT_USER_SETTINGS.enabledPlugins],
        concurrency:
          typeof parsed.concurrency === "number" && parsed.concurrency > 0
            ? Math.min(16, Math.max(1, parsed.concurrency))
            : DEFAULT_USER_SETTINGS.concurrency,
        pluginTimeoutMs:
          typeof parsed.pluginTimeoutMs === "number" &&
          parsed.pluginTimeoutMs > 0
            ? parsed.pluginTimeoutMs
            : DEFAULT_USER_SETTINGS.pluginTimeoutMs,
      };

      // 过滤无效插件
      validated.enabledPlugins = validated.enabledPlugins.filter((name) =>
        ALL_PLUGIN_NAMES.includes(name as any)
      );

      // 仅当插件和 TG 都为空时补默认插件，否则尊重用户选择（如只选 TG 不选插件）
      if (
        validated.enabledPlugins.length === 0 &&
        validated.enabledTgChannels.length === 0
      ) {
        validated.enabledPlugins = [...DEFAULT_USER_SETTINGS.enabledPlugins];
      }

      settings.value = validated;
    } catch (_error) {
      // Silent failure - settings will use defaults
    }
  }

  // 保存设置
  function saveSettings(): void {
    if (typeof window === "undefined") return;

    try {
      localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings.value));
    } catch (_error) {
      // Silent failure
    }
  }

  // 重置为默认
  function resetToDefault(): void {
    if (typeof window === "undefined") return;

    try {
      localStorage.removeItem(STORAGE_KEYS.settings);
    } catch (_error) {
      // Silent failure
    }

    settings.value = {
      enabledTgChannels: [
        ...(defaultTgChannels.value?.length ? defaultTgChannels.value : channelsConfig.defaultChannels),
      ],
      enabledPlugins: [...DEFAULT_USER_SETTINGS.enabledPlugins],
      concurrency: DEFAULT_USER_SETTINGS.concurrency,
      pluginTimeoutMs: DEFAULT_USER_SETTINGS.pluginTimeoutMs,
    };

    // 刷新页面以完全重置
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  }

  // 全选插件
  function onSelectAll(): void {
    settings.value.enabledPlugins = [...ALL_PLUGIN_NAMES];
    saveSettings();
  }

  // 全不选插件
  function onClearAll(): void {
    settings.value.enabledPlugins = [];
    saveSettings();
  }

  // 全选 TG 频道
  function onSelectAllTg(): void {
    settings.value.enabledTgChannels = [
      ...(defaultTgChannels.value?.length ? defaultTgChannels.value : channelsConfig.defaultChannels),
    ];
    saveSettings();
  }

  // 全不选 TG 频道
  function onClearAllTg(): void {
    settings.value.enabledTgChannels = [];
    saveSettings();
  }

  // 页面加载时自动加载设置
  if (typeof window !== "undefined") {
    loadSettings();
  }

  return {
    settings,
    loadSettings,
    saveSettings,
    resetToDefault,
    onSelectAll,
    onClearAll,
    onSelectAllTg,
    onClearAllTg,
  };
}
