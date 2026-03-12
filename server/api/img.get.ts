import { defineEventHandler, getQuery, createError, setHeader } from "h3";
import { ofetch } from "ofetch";

const ALLOWED_HOSTS = /^img[1-9]\.doubanio\.com$/;

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const raw = (query.url as string) || "";
  const url = decodeURIComponent(raw);

  if (!url || !url.startsWith("https://")) {
    throw createError({ statusCode: 400, statusMessage: "Invalid url" });
  }

  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw createError({ statusCode: 400, statusMessage: "Invalid url" });
  }

  if (!ALLOWED_HOSTS.test(host)) {
    throw createError({ statusCode: 403, statusMessage: "Host not allowed" });
  }

  try {
    // 使用更真实的请求头，增加超时时间和重试
    const resp = await ofetch<ArrayBuffer>(url, {
      responseType: "arrayBuffer",
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        "Referer": "https://movie.douban.com/",
        "Accept": "image/webp,image/apng,image/*,*/*;q=0.8",
      },
      timeout: 30000, // 增加到30秒
      retry: 3, // 增加重试次数
      retryDelay: 1000, // 重试延迟
    });

    const buffer = Buffer.from(resp);
    setHeader(event, "Cache-Control", "public, max-age=86400");
    const ext = url.split(".").pop()?.toLowerCase() || "jpg";
    const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    setHeader(event, "Content-Type", mime);
    return buffer;
  } catch (error: any) {
    // 超时或网络错误时，返回透明占位图或重定向
    console.error(`Failed to fetch image: ${url}`, error.message);

    // 返回一个简单的错误响应，让前端使用占位图
    throw createError({
      statusCode: 503,
      statusMessage: "Image fetch timeout"
    });
  }
});
