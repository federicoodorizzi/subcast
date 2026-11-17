// Keys derived from APP_SECRET with HKDF, one per purpose, so a session key can never decrypt a
// credential. Credentials and provider sessions are sealed with AES-256-GCM, bound to the row they
// belong to through the additional data, so a ciphertext copied to another row won't open.

const enc = new TextEncoder();
const dec = new TextDecoder();

type Purpose = "credentials" | "session-cookie";

const keyCache = new Map<string, Promise<CryptoKey>>();

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function deriveKey(appSecret: string, purpose: Purpose): Promise<CryptoKey> {
  const cacheKey = `${purpose}:${appSecret}`;
  let key = keyCache.get(cacheKey);
  if (!key) {
    key = (async () => {
      const ikm = await crypto.subtle.importKey("raw", hexToBytes(appSecret), "HKDF", false, ["deriveKey"]);
      const params = { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: enc.encode(`podcast-proxy/${purpose}/v1`) };
      return purpose === "credentials"
        ? crypto.subtle.deriveKey(params, ikm, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"])
        : crypto.subtle.deriveKey(params, ikm, { name: "HMAC", hash: "SHA-256", length: 256 }, false, ["sign", "verify"]);
    })();
    keyCache.set(cacheKey, key);
  }
  return key;
}

/** Seals `value` as JSON; `binding` (such as "account:3:credentials") must be given again to open it. */
export async function seal(appSecret: string, binding: string, value: unknown): Promise<string> {
  const key = await deriveKey(appSecret, "credentials");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(binding) }, key, enc.encode(JSON.stringify(value)));
  return `v1.${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(ct))}`;
}

export async function open<T>(appSecret: string, binding: string, sealed: string): Promise<T> {
  const [version, iv, ct] = sealed.split(".");
  if (version !== "v1" || !iv || !ct) throw new Error("Unknown sealed value format");
  const key = await deriveKey(appSecret, "credentials");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64UrlToBytes(iv), additionalData: enc.encode(binding) }, key, base64UrlToBytes(ct));
  return JSON.parse(dec.decode(pt)) as T;
}

export async function hmacSign(appSecret: string, message: string): Promise<string> {
  const key = await deriveKey(appSecret, "session-cookie");
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message))));
}

export async function hmacVerify(appSecret: string, message: string, signature: string): Promise<boolean> {
  const key = await deriveKey(appSecret, "session-cookie");
  try {
    return await crypto.subtle.verify("HMAC", key, base64UrlToBytes(signature), enc.encode(message));
  } catch {
    return false;
  }
}

/** Compares two strings in time that depends only on their lengths, by comparing their SHA-256 digests. */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [da, db] = await Promise.all([sha256(a), sha256(b)]);
  return crypto.subtle.timingSafeEqual(da, db);
}

async function sha256(s: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", enc.encode(s));
}

export async function sha256Hex(s: string): Promise<string> {
  return [...new Uint8Array(await sha256(s))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A random URL-safe token with 256 bits of entropy. */
export function randomToken(): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}
