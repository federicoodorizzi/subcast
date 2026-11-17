// Deploys the Worker with the secrets it doesn't have yet, so a new deployment works with no manual step.
// Deploy to Cloudflare's Workers Builds runs this as `pnpm run deploy`; it builds first, then deploys, and so can you after
// `pnpm exec wrangler login`. Extra arguments go on to `wrangler deploy`.
//
// - APP_SECRET: made here on the first deploy (32 random bytes), and kept by every later one, since a
//   new one would make the stored credentials unreadable.
// - ADMIN_PASSWORD: the Deploy to Cloudflare form sets it. A deploy whose environment has
//   ADMIN_PASSWORD gives it to a Worker without one; failing both, one is made and printed once.
//
// The secrets go up with the code in one `wrangler deploy --secrets-file`, from a file only this
// process can read, which is deleted straight after. Their values never reach the output, except a
// password this script made, which you need in order to sign in.

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const passthrough = process.argv.slice(2);

function wrangler(args: string[], capture: boolean) {
  return spawnSync("pnpm", ["exec", "wrangler", ...args], { encoding: "utf8", stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit" });
}

/** The names of the Worker's secrets, or none when the Worker doesn't exist yet. */
function secretNames(): string[] {
  const target = passthrough.flatMap((a, i, all) => (a === "--name" || a === "--config" || a === "-c" ? [a, all[i + 1]!] : []));
  const listed = wrangler(["secret", "list", "--format", "json", ...target], true);
  if (listed.status === 0) {
    try {
      return (JSON.parse(listed.stdout) as { name: string }[]).map((s) => s.name);
    } catch {
      /* fall through */
    }
  }
  if (/not found|does not exist|10007/i.test(listed.stdout + listed.stderr)) return [];
  throw new Error(`Couldn't list the Worker's secrets:\n${listed.stdout}${listed.stderr}`);
}

// Build the admin app and the Worker first. Vite writes the Worker's deploy config to
// .wrangler/deploy/config.json, which `wrangler deploy` then picks up on its own.
const build = spawnSync("pnpm", ["exec", "vite", "build"], { stdio: "inherit" });
if (build.status !== 0) process.exit(build.status ?? 1);

const names = secretNames();
const secrets: Record<string, string> = {};
let madePassword: string | null = null;

if (!names.includes("APP_SECRET")) secrets.APP_SECRET = randomBytes(32).toString("hex");
if (!names.includes("ADMIN_PASSWORD")) {
  if (process.env.ADMIN_PASSWORD) secrets.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  else secrets.ADMIN_PASSWORD = madePassword = randomBytes(18).toString("base64url");
}

const made = Object.keys(secrets);
console.log(made.length ? `Deploying with new secrets: ${made.join(", ")}` : "Deploying with the Worker's secrets as they are");

let dir: string | null = null;
const args = ["deploy", ...passthrough];
if (made.length) {
  dir = mkdtempSync(join(tmpdir(), "podcast-proxy-"));
  const file = join(dir, "secrets.json");
  writeFileSync(file, JSON.stringify(secrets), { mode: 0o600 });
  args.push("--secrets-file", file);
}
try {
  const result = wrangler(args, false);
  if (result.status !== 0) process.exit(result.status ?? 1);
} finally {
  if (dir) rmSync(dir, { recursive: true, force: true });
}

if (madePassword) {
  console.log(`\nThe admin password is ${madePassword}\nKeep it somewhere safe; change it any time with \`pnpm exec wrangler secret put ADMIN_PASSWORD\`.`);
}
