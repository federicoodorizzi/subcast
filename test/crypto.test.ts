import { describe, expect, it } from "vitest";
import { hmacSign, hmacVerify, open, seal } from "../src/crypto";

const secret = "ab".repeat(32);

describe("seal/open", () => {
  it("round-trips a value", async () => {
    const sealed = await seal(secret, "account:1:credentials", { email: "a@b.c", password: "p" });
    expect(sealed).not.toContain("a@b.c");
    expect(await open(secret, "account:1:credentials", sealed)).toEqual({ email: "a@b.c", password: "p" });
  });

  it("won't open a value sealed for another row or with another secret", async () => {
    const sealed = await seal(secret, "account:1:credentials", "x");
    await expect(open(secret, "account:2:credentials", sealed)).rejects.toThrow();
    await expect(open("cd".repeat(32), "account:1:credentials", sealed)).rejects.toThrow();
  });
});

describe("hmac", () => {
  it("verifies only the signed message", async () => {
    const sig = await hmacSign(secret, "hello");
    expect(await hmacVerify(secret, "hello", sig)).toBe(true);
    expect(await hmacVerify(secret, "hellO", sig)).toBe(false);
    expect(await hmacVerify(secret, "hello", "garbage!")).toBe(false);
  });
});
