import { describe, expect, it } from "vitest";
import { campaignFormValues, campaignSchema } from "@/lib/validation/campaign";
import { sampleCampaign } from "@/lib/sample-campaign";

describe("campaign input boundaries", () => {
  it("accepts the actual MyHotelLine brief and both supported durations", () => {
    expect(campaignSchema.parse(sampleCampaign)).toEqual(sampleCampaign);
    expect(campaignSchema.parse({ ...sampleCampaign, duration: 30 }).duration).toBe(30);
  });

  it.each([0, 14, 16, 15.5, 60, "15", true, null])(
    "rejects an unsupported duration: %s",
    (duration) => {
      expect(campaignSchema.safeParse({ ...sampleCampaign, duration }).success).toBe(false);
    },
  );

  it("normalizes whitespace and optional blank websites", () => {
    const result = campaignSchema.parse({
      ...sampleCampaign,
      product_name: "  MyHotelLine  ",
      website_url: "",
    });
    expect(result.product_name).toBe("MyHotelLine");
    expect(result.website_url).toBeNull();
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,hello",
    "file:///etc/passwd",
    "myhotel.example",
    "ftp://example.com",
  ])('rejects unsafe or incomplete website "%s"', (website_url) => {
    expect(campaignSchema.safeParse({ ...sampleCampaign, website_url }).success).toBe(false);
  });

  it("accepts HTTPS references without fetching their contents", () => {
    expect(
      campaignSchema.parse({ ...sampleCampaign, website_url: "https://example.com/product?demo=1" })
        .website_url,
    ).toBe("https://example.com/product?demo=1");
  });

  it("rejects privilege and ownership fields in untrusted briefs", () => {
    expect(
      campaignSchema.safeParse({ ...sampleCampaign, user_id: "another-user", status: "approved" })
        .success,
    ).toBe(false);
  });

  it("enforces useful minimums and bounds expensive input", () => {
    expect(campaignSchema.safeParse({ ...sampleCampaign, description: "tiny" }).success).toBe(
      false,
    );
    expect(
      campaignSchema.safeParse({ ...sampleCampaign, description: "x".repeat(4001) }).success,
    ).toBe(false);
    expect(campaignSchema.safeParse({ ...sampleCampaign, target_audience: "  " }).success).toBe(
      false,
    );
    expect(campaignSchema.safeParse({ ...sampleCampaign, name: "x".repeat(121) }).success).toBe(
      false,
    );
  });

  it("reads only allowlisted form fields and converts a supported duration explicitly", () => {
    const form = new FormData();
    Object.entries(sampleCampaign).forEach(([key, value]) => {
      if (value !== null) form.set(key, String(value));
    });
    form.set("status", "approved");
    form.set("user_id", "someone-else");
    const result = campaignSchema.parse(campaignFormValues(form));
    expect(result).toEqual(sampleCampaign);
    expect(result).not.toHaveProperty("user_id");
    expect(result).not.toHaveProperty("status");
  });

  it("does not coerce an empty or malformed form duration into a valid number", () => {
    for (const value of ["", "15.0", "true", "30seconds"]) {
      const form = new FormData();
      Object.entries(sampleCampaign).forEach(([key, item]) => {
        if (item !== null) form.set(key, String(item));
      });
      form.set("duration", value);
      expect(campaignSchema.safeParse(campaignFormValues(form)).success).toBe(false);
    }
  });
});
