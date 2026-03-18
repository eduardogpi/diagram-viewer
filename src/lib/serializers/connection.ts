export function parseTagsJson(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function serializeTags(tags: string[] | null | undefined): string {
  if (!tags || tags.length === 0) {
    return "[]";
  }

  return JSON.stringify(tags.filter((tag): tag is string => typeof tag === "string"));
}
