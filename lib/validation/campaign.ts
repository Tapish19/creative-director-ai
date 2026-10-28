import { z } from "zod";

const requiredText = (label: string, max: number) =>
  z
    .string()
    .trim()
    .min(2, `${label} must have at least 2 characters.`)
    .max(max, `${label} must have at most ${max} characters.`);

export const campaignSchema = z
  .object({
    name: requiredText("Campaign name", 120),
    product_name: requiredText("Product name", 120),
    description: z
      .string()
      .trim()
      .min(20, "Describe your product in at least 20 characters.")
      .max(4000),
    target_audience: requiredText("Target audience", 500),
    tone: requiredText("Tone", 120),
    duration: z.union([z.literal(15), z.literal(30)], { error: "Choose a 15 or 30 second video." }),
    website_url: z
      .union([
        z.literal(""),
        z
          .url({ protocol: /^https?$/, error: "Enter a complete http:// or https:// website URL." })
          .max(2048),
      ])
      .transform((value) => value || null)
      .nullable(),
    goal: requiredText("Campaign goal", 500),
  })
  .strict();

// Explicit conversion avoids accepting booleans or other values as valid durations.
export function campaignFormValues(form: FormData) {
  const duration = form.get("duration");
  return {
    name: form.get("name"),
    product_name: form.get("product_name"),
    description: form.get("description"),
    target_audience: form.get("target_audience"),
    tone: form.get("tone"),
    duration: duration === "15" ? 15 : duration === "30" ? 30 : duration,
    website_url: form.get("website_url") ?? "",
    goal: form.get("goal"),
  };
}
