import configurationYaml from "../../../configuration.yaml";
import type { Env } from "./env";

type BrandingConfiguration = {
  productName: string;
  logoUrl: string;
  footerBadge: string;
  footerLicense: string;
};

type UsageConfiguration = {
  showPublicAggregate: boolean;
  minimumAggregateUsers: number;
  allowUserBitrateSettings: boolean;
  monthlyUserQuotaBytes: number | null;
  monthlyTurnLimitBytes: number | null;
};

type TemporaryAccountConfiguration = {
  enabled: boolean;
  lifetimeHours: number;
  maxActiveAccounts: number;
  perIpCreationLimit: number;
  perIpWindowMinutes: number;
  monthlyTurnQuotaBytes: number | null;
  monthlyTurnLimitBytes: number | null;
  monthlyAggregateBudgetBytes: number | null;
};

export type SiteConfiguration = {
  branding: BrandingConfiguration;
  usage: UsageConfiguration;
  temporaryAccounts: TemporaryAccountConfiguration;
};

export type PublicSiteConfiguration = Pick<SiteConfiguration, "branding"> & {
  usage: Pick<UsageConfiguration, "showPublicAggregate" | "allowUserBitrateSettings">;
  temporaryAccounts: Pick<TemporaryAccountConfiguration, "enabled" | "lifetimeHours">;
};

const SETTINGS_KEY = "site_configuration";
const SECTION_KEYS = {
  branding: ["productName", "logoUrl", "footerBadge", "footerLicense"],
  usage: ["showPublicAggregate", "minimumAggregateUsers", "allowUserBitrateSettings", "monthlyUserQuotaBytes", "monthlyTurnLimitBytes"],
  temporaryAccounts: ["enabled", "lifetimeHours", "maxActiveAccounts", "perIpCreationLimit", "perIpWindowMinutes", "monthlyTurnQuotaBytes", "monthlyTurnLimitBytes", "monthlyAggregateBudgetBytes"],
} as const;

function parseYamlScalar(source: string): unknown {
  const value = source.trim();
  if (value.startsWith('"')) {
    try { return JSON.parse(value) as unknown; } catch { throw new Error("Invalid quoted value in configuration.yaml"); }
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'") || value.length < 2) throw new Error("Invalid quoted value in configuration.yaml");
    return value.slice(1, -1).replaceAll("''", "'");
  }
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null" || value === "~") return null;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return Number(value);
  const inlineComment = value.search(/\s+#/);
  return inlineComment < 0 ? value : value.slice(0, inlineComment).trimEnd();
}

/** Parses the intentionally small, scalar-only YAML subset used by configuration.yaml. */
export function parseConfigurationYaml(source: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  const stack: Array<{ indent: number; value: Record<string, unknown> }> = [{ indent: -2, value: root }];
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    if (line.includes("\t")) throw new Error(`Tabs are not allowed in configuration.yaml (line ${index + 1})`);
    const indent = line.length - line.trimStart().length;
    if (indent % 2 !== 0) throw new Error(`Invalid indentation in configuration.yaml (line ${index + 1})`);
    const match = line.trim().match(/^([A-Za-z][A-Za-z0-9_-]*):(?:\s+(.*))?$/);
    if (!match) throw new Error(`Unsupported YAML syntax in configuration.yaml (line ${index + 1})`);
    const key = match[1]!;
    const rawValue = match[2] ?? "";
    while (stack.length > 1 && stack[stack.length - 1]!.indent >= indent) stack.pop();
    const parent = stack[stack.length - 1]!.value;
    if (Object.hasOwn(parent, key)) throw new Error(`Duplicate configuration key: ${key}`);
    if (!rawValue.trim()) {
      const child: Record<string, unknown> = {};
      parent[key] = child;
      stack.push({ indent, value: child });
    } else {
      parent[key] = parseYamlScalar(rawValue);
    }
  }
  return root;
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function textValue(value: unknown, fallback: string, max: number): string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max ? value.trim() : fallback;
}

function nullableBytes(value: unknown, fallback: number | null): number | null {
  return value === null || value === undefined
    ? fallback
    : Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 1_000_000_000_000_000 ? Number(value) : fallback;
}

function integer(value: unknown, fallback: number, min: number, max: number): number {
  return Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max ? Number(value) : fallback;
}

function safeLogoPath(value: string): boolean {
  return value === "" || (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") && !/[\s<>"'`]/.test(value)
    && !/(^|\/)\.\.(\/|$)/.test(value) && /^\/[A-Za-z0-9/_.,@%+?=&#-]*$/.test(value));
}

function overlay(base: SiteConfiguration, override: unknown): SiteConfiguration {
  const root = object(override);
  const branding = object(root?.branding);
  const usage = object(root?.usage);
  const temporary = object(root?.temporaryAccounts);
  const brand: BrandingConfiguration = {
    productName: textValue(branding?.productName, base.branding.productName, 60),
    logoUrl: typeof branding?.logoUrl === "string" && branding.logoUrl.length <= 500 && safeLogoPath(branding.logoUrl) ? branding.logoUrl : base.branding.logoUrl,
    footerBadge: typeof branding?.footerBadge === "string" && branding.footerBadge.length <= 100 ? branding.footerBadge : base.branding.footerBadge,
    footerLicense: typeof branding?.footerLicense === "string" && branding.footerLicense.length <= 140 ? branding.footerLicense : base.branding.footerLicense,
  };
  const normalizedBrand = { ...brand, footerBadge: brand.footerBadge.trim(), footerLicense: brand.footerLicense.trim() };
  return {
    branding: normalizedBrand,
    usage: {
      showPublicAggregate: typeof usage?.showPublicAggregate === "boolean" ? usage.showPublicAggregate : base.usage.showPublicAggregate,
      minimumAggregateUsers: integer(usage?.minimumAggregateUsers, base.usage.minimumAggregateUsers, 5, 100),
      allowUserBitrateSettings: typeof usage?.allowUserBitrateSettings === "boolean" ? usage.allowUserBitrateSettings : base.usage.allowUserBitrateSettings,
      monthlyUserQuotaBytes: nullableBytes(usage?.monthlyUserQuotaBytes, base.usage.monthlyUserQuotaBytes),
      monthlyTurnLimitBytes: nullableBytes(usage?.monthlyTurnLimitBytes, base.usage.monthlyTurnLimitBytes),
    },
    temporaryAccounts: {
      enabled: typeof temporary?.enabled === "boolean" ? temporary.enabled : base.temporaryAccounts.enabled,
      lifetimeHours: integer(temporary?.lifetimeHours, base.temporaryAccounts.lifetimeHours, 1, 168),
      maxActiveAccounts: integer(temporary?.maxActiveAccounts, base.temporaryAccounts.maxActiveAccounts, 0, 100_000),
      perIpCreationLimit: integer(temporary?.perIpCreationLimit, base.temporaryAccounts.perIpCreationLimit, 0, 50),
      perIpWindowMinutes: integer(temporary?.perIpWindowMinutes, base.temporaryAccounts.perIpWindowMinutes, 1, 1_440),
      monthlyTurnQuotaBytes: nullableBytes(temporary?.monthlyTurnQuotaBytes, base.temporaryAccounts.monthlyTurnQuotaBytes),
      monthlyTurnLimitBytes: nullableBytes(temporary?.monthlyTurnLimitBytes, base.temporaryAccounts.monthlyTurnLimitBytes),
      monthlyAggregateBudgetBytes: nullableBytes(temporary?.monthlyAggregateBudgetBytes, base.temporaryAccounts.monthlyAggregateBudgetBytes),
    },
  };
}

export const DEFAULT_CONFIGURATION = overlay({
  branding: { productName: "SparkCall", logoUrl: "", footerBadge: "", footerLicense: "" },
  usage: { showPublicAggregate: false, minimumAggregateUsers: 5, allowUserBitrateSettings: true, monthlyUserQuotaBytes: null, monthlyTurnLimitBytes: null },
  temporaryAccounts: { enabled: true, lifetimeHours: 24, maxActiveAccounts: 0, perIpCreationLimit: 8, perIpWindowMinutes: 60, monthlyTurnQuotaBytes: null, monthlyTurnLimitBytes: null, monthlyAggregateBudgetBytes: null },
}, parseConfigurationYaml(configurationYaml) as unknown as SiteConfiguration);

export async function getSiteConfiguration(env: Env): Promise<SiteConfiguration> {
  const row = await env.DB.prepare("SELECT value_json FROM app_settings WHERE key=?1").bind(SETTINGS_KEY).first<{ value_json: string }>();
  if (!row) return DEFAULT_CONFIGURATION;
  try {
    return overlay(DEFAULT_CONFIGURATION, JSON.parse(row.value_json) as unknown);
  } catch {
    return DEFAULT_CONFIGURATION;
  }
}

export function publicSiteConfiguration(config: SiteConfiguration): PublicSiteConfiguration {
  return {
    branding: config.branding,
    usage: { showPublicAggregate: config.usage.showPublicAggregate, allowUserBitrateSettings: config.usage.allowUserBitrateSettings },
    temporaryAccounts: { enabled: config.temporaryAccounts.enabled, lifetimeHours: config.temporaryAccounts.lifetimeHours },
  };
}

function validateBytes(value: unknown, label: string): number | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 1_000_000_000_000_000) throw new Error(`${label} must be null or an integer between 0 and 1000000000000000`);
  return Number(value);
}

function validateInteger(value: unknown, label: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) throw new Error(`${label} must be an integer between ${min} and ${max}`);
  return Number(value);
}

/** Strictly allowlists admin-editable, non-secret settings; all external logo URLs are rejected. */
export function validateAdminConfigurationPatch(input: unknown): Partial<SiteConfiguration> {
  const root = object(input);
  if (!root || Object.keys(root).some((key) => !Object.hasOwn(SECTION_KEYS, key))) throw new Error("Only branding, usage, and temporaryAccounts settings may be changed");
  const patch: Partial<SiteConfiguration> = {};
  for (const section of Object.keys(SECTION_KEYS) as Array<keyof typeof SECTION_KEYS>) {
    if (!Object.hasOwn(root, section)) continue;
    const source = object(root[section]);
    if (!source || Object.keys(source).some((key) => !(SECTION_KEYS[section] as readonly string[]).includes(key))) throw new Error(`Invalid ${section} settings`);
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(source)) {
      if (section === "branding") {
        if (key === "productName") {
          if (typeof value !== "string" || !value.trim() || value.length > 60) throw new Error("Product name must contain 1–60 characters");
          cleaned[key] = value.trim();
        } else if (key === "logoUrl") {
          if (typeof value !== "string" || value.length > 500 || !safeLogoPath(value)) throw new Error("Logo must be blank or a same-origin path beginning with /");
          cleaned[key] = value;
        } else {
          const max = key === "footerBadge" ? 100 : 140;
          if (typeof value !== "string" || value.length > max) throw new Error(`${key} must be text of at most ${max} characters`);
          cleaned[key] = value.trim();
        }
      } else if (section === "usage") {
        if (key === "showPublicAggregate") {
          if (typeof value !== "boolean") throw new Error("showPublicAggregate must be true or false");
          cleaned[key] = value;
        } else if (key === "allowUserBitrateSettings") {
          if (typeof value !== "boolean") throw new Error("allowUserBitrateSettings must be true or false");
          cleaned[key] = value;
        } else if (key === "minimumAggregateUsers") cleaned[key] = validateInteger(value, key, 5, 100);
        else cleaned[key] = validateBytes(value, key);
      } else if (key === "enabled") {
        if (typeof value !== "boolean") throw new Error("enabled must be true or false");
        cleaned[key] = value;
      } else if (key === "lifetimeHours") cleaned[key] = validateInteger(value, key, 1, 168);
      else if (key === "maxActiveAccounts") cleaned[key] = validateInteger(value, key, 0, 100_000);
      else if (key === "perIpCreationLimit") cleaned[key] = validateInteger(value, key, 0, 50);
      else if (key === "perIpWindowMinutes") cleaned[key] = validateInteger(value, key, 1, 1_440);
      else cleaned[key] = validateBytes(value, key);
    }
    (patch as Record<string, unknown>)[section] = cleaned;
  }
  if (!Object.keys(patch).length || Object.values(patch).every((section) => !section || !Object.keys(section).length)) throw new Error("Provide at least one valid setting");
  return patch;
}

function configuredEnvironmentQuota(env: Env): number | null {
  const parsed = Number(env.TURN_MONTHLY_QUOTA_BYTES);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function userQuotaBytes(config: SiteConfiguration, env: Env, isTemporary: boolean): number | null {
  if (isTemporary && config.temporaryAccounts.monthlyTurnQuotaBytes !== null) return config.temporaryAccounts.monthlyTurnQuotaBytes || null;
  if (config.usage.monthlyUserQuotaBytes !== null) return config.usage.monthlyUserQuotaBytes || null;
  return configuredEnvironmentQuota(env);
}

/** A per-user row overrides class defaults; zero means explicitly unlimited, while no row inherits policy. */
export async function getUserTurnPolicy(env: Env, config: SiteConfiguration, userId: string, isTemporary: boolean) {
  const override = await env.DB.prepare("SELECT monthly_turn_limit_bytes FROM user_settings WHERE user_id=?1")
    .bind(userId).first<{ monthly_turn_limit_bytes: number }>();
  if (override) {
    const bytes = Math.max(0, Number(override.monthly_turn_limit_bytes) || 0);
    return { limitBytes: bytes || null, displayQuotaBytes: bytes || null, hasIndividualOverride: true };
  }
  const classLimit = isTemporary && config.temporaryAccounts.monthlyTurnLimitBytes !== null
    ? config.temporaryAccounts.monthlyTurnLimitBytes
    : config.usage.monthlyTurnLimitBytes;
  if (classLimit !== null) {
    const bytes = Math.max(0, classLimit);
    return { limitBytes: bytes || null, displayQuotaBytes: bytes || null, hasIndividualOverride: false };
  }
  return { limitBytes: null, displayQuotaBytes: userQuotaBytes(config, env, isTemporary), hasIndividualOverride: false };
}

export function temporaryAggregateBudgetBytes(config: SiteConfiguration): number | null {
  return config.temporaryAccounts.monthlyAggregateBudgetBytes || null;
}
