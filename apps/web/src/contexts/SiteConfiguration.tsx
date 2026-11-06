import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type PublicSiteConfiguration } from "../lib/api";

const DEFAULT_PUBLIC_CONFIGURATION: PublicSiteConfiguration = {
  branding: {
    productName: "SparkCall",
    logoUrl: "",
    footerBadge: "Design with ❤️ by @BOOMDEE",
    footerLicense: "SparkCall · Open source under Apache-2.0",
  },
  usage: { showPublicAggregate: false, allowUserBitrateSettings: true },
  temporaryAccounts: { enabled: true, lifetimeHours: 24 },
};

const SiteConfigurationContext = createContext<PublicSiteConfiguration>(DEFAULT_PUBLIC_CONFIGURATION);

export function SiteConfigurationProvider({ children }: { children: ReactNode }) {
  const [configuration, setConfiguration] = useState(DEFAULT_PUBLIC_CONFIGURATION);
  useEffect(() => {
    let active = true;
    void api<PublicSiteConfiguration>("/api/config").then((result) => {
      if (active && result?.branding?.productName) setConfiguration(result);
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  useEffect(() => {
    document.title = configuration.branding.productName;
    if (!configuration.branding.logoUrl) return;
    let icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!icon) {
      icon = document.createElement("link");
      icon.rel = "icon";
      document.head.append(icon);
    }
    icon.href = configuration.branding.logoUrl;
  }, [configuration.branding.logoUrl, configuration.branding.productName]);
  return <SiteConfigurationContext.Provider value={configuration}>{children}</SiteConfigurationContext.Provider>;
}

export function useSiteConfiguration() {
  return useContext(SiteConfigurationContext);
}
