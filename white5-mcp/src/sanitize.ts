export function sanitizeResult<T>(value: T, env: Record<string, unknown>): T {
  const secrets = Object.entries(env)
    .filter(([key, item]) => /TOKEN|SECRET|PRIVATE_KEY|ACCESS_KEY/.test(key) && typeof item === "string" && item.length > 3)
    .map(([, item]) => String(item));
  const blockedKeys = /^(access_?token|refresh_?token|authorization|client_?secret|private_?key|appsecret_proof)$/i;
  const clean = (item: unknown): unknown => {
    if (typeof item === "string") {
      let text = item;
      for (const secret of secrets) text = text.replaceAll(secret, "[redacted]");
      return text;
    }
    if (Array.isArray(item)) return item.map(clean);
    if (item && typeof item === "object") {
      return Object.fromEntries(Object.entries(item).map(([key, entry]) => [key, blockedKeys.test(key) ? "[redacted]" : clean(entry)]));
    }
    return item;
  };
  return clean(value) as T;
}

export function errorResult(provider: string, error: unknown) {
  const message = error instanceof Error ? error.message.slice(0, 1_000) : "Request failed.";
  return { isError: true, content: [{ type: "text" as const, text: `${provider} service error: ${message}` }] };
}
