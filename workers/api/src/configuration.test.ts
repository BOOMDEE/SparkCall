import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIGURATION, parseConfigurationYaml, publicSiteConfiguration, userQuotaBytes, validateAdminConfigurationPatch } from "./configuration";

const env = { TURN_MONTHLY_QUOTA_BYTES: "5000000000" } as any;

describe("site configuration", () => {
  it("loads the public root YAML defaults and keeps public totals off by default", () => {
    expect(DEFAULT_CONFIGURATION.branding.productName).toBe("SparkCall");
    expect(DEFAULT_CONFIGURATION.usage.showPublicAggregate).toBe(false);
    expect(DEFAULT_CONFIGURATION.temporaryAccounts).toMatchObject({ enabled: true, lifetimeHours: 24, maxActiveAccounts: 0 });
    expect(publicSiteConfiguration(DEFAULT_CONFIGURATION)).not.toHaveProperty("temporaryAccounts.monthlyTurnQuotaBytes");
    expect(publicSiteConfiguration(DEFAULT_CONFIGURATION)).not.toHaveProperty("usage.minimumAggregateUsers");
  });

  it("parses quoted Unicode scalars, booleans, numbers, nulls, and nested sections", () => {
    const parsed = parseConfigurationYaml('branding:\n  productName: "Call One"\n  footerBadge: "Design \u2764\ufe0f"\nusage:\n  showPublicAggregate: true\n  minimumAggregateUsers: 6\n  monthlyUserQuotaBytes: null\n');
    expect(parsed).toMatchObject({ branding: { productName: "Call One", footerBadge: "Design ❤️" }, usage: { showPublicAggregate: true, minimumAggregateUsers: 6, monthlyUserQuotaBytes: null } });
  });

  it("rejects unsupported YAML syntax and duplicate keys", () => {
    expect(() => parseConfigurationYaml("branding:\n  productName: SparkCall\n  productName: Other\n")).toThrow("Duplicate configuration key");
    expect(() => parseConfigurationYaml("items:\n  - unsafe\n")).toThrow("Unsupported YAML syntax");
    expect(() => parseConfigurationYaml("branding:\n\tproductName: SparkCall\n")).toThrow("Tabs are not allowed");
  });

  it("validates bounded settings, a privacy floor, and same-origin-only logos", () => {
    expect(validateAdminConfigurationPatch({ branding: { productName: "New Name", logoUrl: "/assets/brand.svg" }, usage: { showPublicAggregate: true, minimumAggregateUsers: 5 }, temporaryAccounts: { maxActiveAccounts: 0 } })).toEqual({
      branding: { productName: "New Name", logoUrl: "/assets/brand.svg" },
      usage: { showPublicAggregate: true, minimumAggregateUsers: 5 },
      temporaryAccounts: { maxActiveAccounts: 0 },
    });
    expect(() => validateAdminConfigurationPatch({ branding: { logoUrl: "https://tracker.example/logo.svg" } })).toThrow("same-origin path");
    expect(() => validateAdminConfigurationPatch({ usage: { minimumAggregateUsers: 1 } })).toThrow("between 5 and 100");
    expect(() => validateAdminConfigurationPatch({ usage: { TURN_ANALYTICS_API_TOKEN: "secret" } })).toThrow();
    expect(() => validateAdminConfigurationPatch({ temporaryAccounts: { lifetimeHours: 0 } })).toThrow("between 1 and 168");
  });

  it("resolves display quotas without treating them as enforcement thresholds", () => {
    expect(userQuotaBytes(DEFAULT_CONFIGURATION, env, false)).toBe(5_000_000_000);
    expect(userQuotaBytes({ ...DEFAULT_CONFIGURATION, usage: { ...DEFAULT_CONFIGURATION.usage, monthlyUserQuotaBytes: 0 } }, env, false)).toBeNull();
    expect(userQuotaBytes({ ...DEFAULT_CONFIGURATION, temporaryAccounts: { ...DEFAULT_CONFIGURATION.temporaryAccounts, monthlyTurnQuotaBytes: 12_000 } }, env, true)).toBe(12_000);
  });
});
