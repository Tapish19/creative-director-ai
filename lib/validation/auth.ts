import { z } from "zod";

export const authSchema = z.object({
  email: z.email("Enter a valid email address.").max(254),
  password: z.string().min(8, "Use at least 8 characters.").max(128),
});

export function safeRedirectPath(value: string | null) {
  // Only relative app paths. Browsers also normalize backslashes into slashes.
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\r\n]/.test(value))
    return "/";
  return value;
}
