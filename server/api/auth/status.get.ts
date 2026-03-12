export default defineEventHandler(() => {
  const config = useRuntimeConfig();
  const pw = (config.searchPassword as string) || "";
  return { locked: !!pw.trim() };
});
