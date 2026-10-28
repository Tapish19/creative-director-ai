import { describe, expect, it } from "vitest";
import { authSchema, safeRedirectPath } from "@/lib/validation/auth";

describe("authentication boundaries", () => {
  it("validates credentials before an external request", () => {
    expect(authSchema.safeParse({ email: "not-email", password: "short" }).success).toBe(false);
    expect(
      authSchema.safeParse({ email: "owner@example.com", password: "strong-password" }).success,
    ).toBe(true);
    expect(
      authSchema.safeParse({ email: "owner@example.com", password: "x".repeat(129) }).success,
    ).toBe(false);
  });

  it.each([
    null,
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "/\n/evil.example",
    "javascript:alert(1)",
  ])("blocks external or ambiguous redirect paths: %s", (path) => {
    expect(safeRedirectPath(path)).toBe("/");
  });

  it("preserves a legitimate local campaign destination", () => {
    expect(safeRedirectPath("/campaigns/new?sample=myhotelline")).toBe(
      "/campaigns/new?sample=myhotelline",
    );
  });
});
