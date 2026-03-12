import { defineEventHandler } from 'h3';
import { getOrCreateHotSearchService } from '../core/services/hotSearchService';
import { existsSync } from 'fs';

export default defineEventHandler(async (event) => {
  try {
    const service = getOrCreateHotSearchService();

    // 获取统计信息
    const stats = await service.getStats();
    const fileSizeMB = service.getDatabaseSize();

    // 检查 JSON 文件是否存在
    const fileExists = existsSync('./data/hot-searches.json');

    const storeType = service.getStoreType();
    const isMemoryMode = storeType === 'memory';

    return {
      code: 0,
      message: 'success',
      data: {
        stats,
        dbSizeMB: fileSizeMB,
        dbExists: fileExists,
        isMemoryMode,
        dbPath: './data/hot-searches.json',
        mode: storeType
      }
    };
  } catch (error) {
    return {
      code: -1,
      message: '获取统计信息失败',
      data: {
        error: error instanceof Error ? error.message : String(error)
      }
    };
  }
});
