export function parseJsonArray<T>(json: string): T[] {
  if (!json || !json.trim()) return [];
  const parsed = JSON.parse(json);
  return Array.isArray(parsed) ? parsed : [parsed];
}
