import { createHash, timingSafeEqual } from "node:crypto";
import { readBody, createError } from "h3";
import { createAuthToken, setAuthCookie } from "../../utils/auth";

function hash(s: string): Buffer {
  return createHash("sha256").update(s, "utf8").digest();
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig();
  const password = (config.searchPassword as string) || "";
  if (!password.trim()) {
    return { ok: true };
  }

  const body = await readBody<{ password?: string }>(event);
  const input = (body?.password ?? "").trim();
  if (!input) {
    throw createError({ statusCode: 400, statusMessage: "password required" });
  }

  const a = hash(input);
  const b = hash(password);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw createError({ statusCode: 401, statusMessage: "invalid password" });
  }

  const token = createAuthToken(password);
  setAuthCookie(event, token);
  return { ok: true };
});
