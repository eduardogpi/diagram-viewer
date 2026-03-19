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

export type ConnectionHealth = {
  status: "ONLINE" | "OFFLINE" | "UNKNOWN";
  checkedAt: string | null;
  error: string | null;
};

const defaultHealth: ConnectionHealth = {
  status: "UNKNOWN",
  checkedAt: null,
  error: null,
};

export function parseConnectionHealth(value: string | null | undefined): ConnectionHealth {
  if (!value) {
    return defaultHealth;
  }

  try {
    const parsed = JSON.parse(value) as Partial<ConnectionHealth>;
    return {
      status:
        parsed.status === "ONLINE" || parsed.status === "OFFLINE" || parsed.status === "UNKNOWN"
          ? parsed.status
          : "UNKNOWN",
      checkedAt: typeof parsed.checkedAt === "string" ? parsed.checkedAt : null,
      error: typeof parsed.error === "string" ? parsed.error : null,
    };
  } catch {
    return defaultHealth;
  }
}

export function serializeConnectionHealth(health: Partial<ConnectionHealth>) {
  return JSON.stringify({
    status: health.status ?? "UNKNOWN",
    checkedAt: health.checkedAt ?? null,
    error: health.error ?? null,
  } satisfies ConnectionHealth);
}
