import { defineEventHandler, getQuery } from "h3";
import { fetchDoubanHotByCategory } from "../core/services/doubanHotService";

export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event);
    const category = (query.category as string) || "douban-movie";
    const page = parseInt((query.page as string) || "1", 10);
    const limit = parseInt((query.limit as string) || "25", 10);

    const data = await fetchDoubanHotByCategory(category, page, limit);

    return {
      code: 0,
      message: "success",
      data: {
        category,
        items: data.items,
        hasMore: data.hasMore,
        page,
        limit,
      },
    };
  } catch (error) {
    console.error("[GET /api/douban-hot] 错误:", error);
    return {
      code: -1,
      message: "获取豆瓣榜单失败",
      data: {
        category,
        items: [],
        hasMore: false,
        page,
        limit,
      },
    };
  }
});
