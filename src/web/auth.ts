import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { hmacSign, hmacVerify, safeEqual, sha256Hex } from "../crypto";
import type { Env } from "../env";

// The admin signs in with ADMIN_PASSWORD and gets a cookie signed with a key derived from APP_SECRET.
// The signature covers a fingerprint of the password, so changing ADMIN_PASSWORD signs everyone out.

const COOKIE = "__Host-pp_session";
const LOCAL_COOKIE = "pp_session";
const SESSION_MS = 30 * 86_400_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type C = Context<{ Bindings: Env; Variables: any }>;

const isLocal = (c: C) => new URL(c.req.url).protocol === "http:";
const cookieName = (c: C) => (isLocal(c) ? LOCAL_COOKIE : COOKIE);

async function payload(env: Env, expires: number): Promise<string> {
  return `admin|${expires}|${(await sha256Hex(env.ADMIN_PASSWORD!)).slice(0, 16)}`;
}

export async function checkPassword(env: Env, given: string): Promise<boolean> {
  return safeEqual(given, env.ADMIN_PASSWORD!);
}

export async function startSession(c: C): Promise<void> {
  const expires = Date.now() + SESSION_MS;
  const sig = await hmacSign(c.env.APP_SECRET!, await payload(c.env, expires));
  setCookie(c, cookieName(c), `${expires}.${sig}`, {
    path: "/",
    httpOnly: true,
    secure: !isLocal(c),
    sameSite: "Strict",
    expires: new Date(expires),
  });
}

export function endSession(c: C): void {
  deleteCookie(c, cookieName(c), { path: "/", secure: !isLocal(c) });
}

export async function isSignedIn(c: C): Promise<boolean> {
  const value = getCookie(c, cookieName(c));
  if (!value) return false;
  const [expiresText, sig] = value.split(".");
  const expires = Number(expiresText);
  if (!sig || !Number.isFinite(expires) || expires < Date.now()) return false;
  return hmacVerify(c.env.APP_SECRET!, await payload(c.env, expires), sig);
}
