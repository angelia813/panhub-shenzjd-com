import { defineEventHandler } from "h3";
import { getOrCreateSearchService } from "../core/services";

export default defineEventHandler(async (event) => {
  try {
    const service = getOrCreateSearchService(useRuntimeConfig());
    const healthStatus = service.getPluginHealthStatus();

    return {
      code: 0,
      message: "success",
      data: {
        total: healthStatus.length,
        healthy: healthStatus.filter((p) => p.isHealthy).length,
        unhealthy: healthStatus.filter((p) => !p.isHealthy).length,
        plugins: healthStatus,
      },
    };
  } catch (error) {
    return {
      code: -1,
      message: "获取插件健康状态失败",
      data: null,
    };
  }
});
