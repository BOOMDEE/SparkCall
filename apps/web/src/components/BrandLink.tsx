import { Phone } from "lucide-react";
import { Link } from "react-router-dom";
import { useSiteConfiguration } from "../contexts/SiteConfiguration";

type BrandLinkProps = {
  to: string;
  ariaLabel?: string;
  className: string;
  markClassName: string;
  iconSize: number;
  filled?: boolean;
};

export function BrandLink({ to, ariaLabel, className, markClassName, iconSize, filled = false }: BrandLinkProps) {
  const { branding } = useSiteConfiguration();
  return <Link to={to} aria-label={ariaLabel || `${branding.productName} home`} className={className}>
    {branding.logoUrl
      ? <img src={branding.logoUrl} alt="" className={`${markClassName} object-contain`} />
      : <span aria-hidden="true" className={markClassName}><Phone size={iconSize} fill={filled ? "currentColor" : "none"} strokeWidth={1.8} /></span>}
    <span>{branding.productName}</span>
  </Link>;
}
