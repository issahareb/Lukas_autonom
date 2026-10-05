import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Link, useLocation } from "wouter";
import { navigation } from "@/lib/navigation";

export function PageHeader({ icon: Icon, title, subtitle, actions, children }: {
  icon?: LucideIcon; title: string; subtitle?: ReactNode; actions?: ReactNode; children?: ReactNode;
}) {
  const [location] = useLocation();
  const current = navigation.find(n => n.href === location);
  const siblings = navigation.filter(n => n.group === current?.group);
  return <header className="workspace-heading">
    <div className="workspace-heading-row">
      <div className="workspace-title-block">
        <p className="workspace-eyebrow">{current?.group ?? "Dein Arbeitsraum"}</p>
        <div className="workspace-title">{Icon && <span className="workspace-title-icon"><Icon size={24} aria-hidden="true" /></span>}<h1>{title}</h1></div>
        {subtitle && <p className="workspace-description">{subtitle}</p>}
      </div>
      {actions && <div className="workspace-actions">{actions}</div>}
    </div>
    {siblings.length > 1 && <nav className="workspace-section-nav" aria-label={`${current?.group} – Bereiche`}>
      {siblings.map(n => <Link key={n.href} href={n.href} aria-current={location === n.href ? "page" : undefined}><n.icon size={15} aria-hidden="true" />{n.label}</Link>)}
    </nav>}
    {children && <div className="workspace-header-extra">{children}</div>}
  </header>;
}
