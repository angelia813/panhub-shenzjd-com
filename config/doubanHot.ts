/**
 * 豆瓣影视榜单配置
 * 直接抓取豆瓣各类榜单页面
 */

export const DOUBAN_HOT_SOURCES = [
  // 电影榜单
  { id: "douban-top250", label: "电影", route: "douban-top250", type: "Top250" },
  { id: "douban-movie", label: "电影", route: "douban-movie", type: "新片榜" },
  { id: "douban-weekly", label: "电影", route: "douban-weekly", type: "口碑榜" },
  { id: "douban-us-box", label: "电影", route: "douban-us-box", type: "北美票房" },
] as const;
