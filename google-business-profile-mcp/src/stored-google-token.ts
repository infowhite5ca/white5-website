import type { ConnectorEnv } from "./google-client";

const TOKEN_KEY = "internal-google-refresh-token:v1";

function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function decode(value: string): ArrayBuffer {
  const binary = atob(value);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return buffer;
}

async function encryptionKey(env: ConnectorEnv): Promise<CryptoKey> {
  const material = new TextEncoder().encode(`white5-google-business:${env.GOOGLE_CLIENT_ID}:${env.GOOGLE_CLIENT_SECRET}`);
  const digest = await crypto.subtle.digest("SHA-256", material);
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function saveInternalGoogleRefreshToken(env: ConnectorEnv, refreshToken: string): Promise<void> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(env),
    new TextEncoder().encode(refreshToken),
  );
  await env.OAUTH_KV.put(TOKEN_KEY, JSON.stringify({ iv: encode(iv), ciphertext: encode(new Uint8Array(ciphertext)) }));
}

export async function loadInternalGoogleRefreshToken(env: ConnectorEnv): Promise<string | null> {
  if (env.GOOGLE_REFRESH_TOKEN) return env.GOOGLE_REFRESH_TOKEN;
  const stored = await env.OAUTH_KV.get(TOKEN_KEY);
  if (!stored) return null;
  try {
    const payload = JSON.parse(stored) as { iv: string; ciphertext: string };
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: decode(payload.iv) },
      await encryptionKey(env),
      decode(payload.ciphertext),
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    return null;
  }
}
