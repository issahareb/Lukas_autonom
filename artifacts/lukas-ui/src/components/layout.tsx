import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import * as Dialog from "@radix-ui/react-dialog";
import { useHealthCheck } from "@workspace/api-client-react";
import { Fehlergrenze } from "@/components/fehlergrenze";
import { LogOut, X, Grid2X2, ArrowUpRight, Search, ChevronRight } from "lucide-react";
import { navigation, navigationGroups, mobileNavigation } from "@/lib/navigation";
import "./app-shell.css";
import "./workspace.css";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: health, isError: healthError } = useHealthCheck();
  const [mehr, setMehr] = useState(false);
  const [suche, setSuche] = useState("");
  const shell = useRef<HTMLDivElement>(null),
    scroll = useRef<HTMLDivElement>(null);
  const current = navigation.find((n) => n.href === location);
  const title = current?.label ?? "Lukas";
  const shown = navigation.filter(n => n.label.toLocaleLowerCase("de").includes(suche.toLocaleLowerCase("de")));
  const online = !healthError && health?.status === "ok";
  useEffect(() => {
    setMehr(false);
    setSuche("");
    scroll.current?.scrollTo({ top: 0 });
  }, [location]);
  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () => {
      const h = viewport?.height ?? window.innerHeight;
      shell.current?.style.setProperty("--app-viewport-height", `${h}px`);
      const el = document.activeElement;
      const editing =
        el instanceof HTMLElement &&
        (el.matches("input,textarea") || el.isContentEditable);
      shell.current?.classList.toggle(
        "keyboard-open",
        editing && window.innerHeight - h > 150,
      );
    };
    update();
    viewport?.addEventListener("resize", update);
    window.addEventListener("resize", update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    return () => {
      viewport?.removeEventListener("resize", update);
      window.removeEventListener("resize", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
    };
  }, []);
  const logout = () => {
    localStorage.removeItem("lukas_token");
    window.location.reload();
  };
  const status = (
    <span className={`app-connection ${online ? "is-online" : ""}`}>
      <span />
      {healthError
        ? "Offline"
        : health
          ? online
            ? "Verbunden"
            : "Offline"
          : "Verbindet …"}
    </span>
  );
  return (
    <div ref={shell} className="app-shell" data-tone={current?.tone ?? "mint"} data-page={location}>
      <aside className="app-sidebar" aria-label="Desktop-Navigation">
        <Link href="/" className="app-brand">
          <span className="app-monogram">L</span>
          <span>
            LUKAS<small>Dein persönlicher Arbeitsraum</small>
          </span>
        </Link>
        <nav aria-label="Bereiche">
          {navigationGroups.map((group, index) => (
            <section className="app-nav-group" key={group} aria-labelledby={"app-nav-group-" + index}>
              <h2 id={"app-nav-group-" + index} className="app-nav-heading">{group}</h2>
              {navigation.filter((n) => n.group === group).map((n) => (
                <Link key={n.href} href={n.href} aria-current={location === n.href ? "page" : undefined} className="app-sidebar-link">
                  <n.icon size={18} aria-hidden="true" />
                  {n.label}
                  {location === n.href && <span className="app-nav-dot" aria-hidden="true" />}
                </Link>
              ))}
            </section>
          ))}
        </nav>
        <div className="app-sidebar-bottom">
          {status}
          <button type="button" onClick={logout} aria-label="Abmelden">
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <header className="app-mobile-header">
        <Link href="/" className="app-mobile-brand">
          <span className="app-monogram">L</span>
          {location === "/" ? "Lukas" : title}
        </Link>
        {status}
      </header>
      <main className="app-main" id="arbeitsbereich">
        <div className="app-topbar">
          <span className="app-breadcrumb">Lukas <ChevronRight size={13} /> {current?.group} <ChevronRight size={13} /> <strong>{title}</strong></span>
          <button type="button" className="app-jump" onClick={() => setMehr(true)}><Search size={15} /> Bereich wechseln <Grid2X2 size={14} /></button>
        </div>
        <div className="app-scroll" ref={scroll}>
          <Fehlergrenze schluessel={location}>{children}</Fehlergrenze>
        </div>
      </main>
      <Dialog.Root open={mehr} onOpenChange={setMehr}>
        <nav className="app-tabbar" aria-label="Hauptnavigation">
          {navigation.filter(n => mobileNavigation.includes(n.href)).map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={location === n.href ? "page" : undefined}
            >
              <span>
                <n.icon size={21} aria-hidden="true" />
              </span>
              {n.label}
            </Link>
          ))}
          <Dialog.Trigger asChild>
            <button
              type="button"
              className={
                !navigation.filter(n => mobileNavigation.includes(n.href)).some((n) => n.href === location)
                  ? "is-current"
                  : ""
              }
              aria-label="Weitere Bereiche öffnen"
            >
              <span>
                <Grid2X2 size={21} aria-hidden="true" />
              </span>
              Mehr
            </button>
          </Dialog.Trigger>
        </nav>
        <Dialog.Portal>
          <Dialog.Overlay className="app-sheet-overlay" />
          <Dialog.Content className="app-sheet">
            <div className="app-sheet-handle" aria-hidden="true" />
            <div className="app-sheet-heading">
              <div>
                <Dialog.Title>Dein Lukas</Dialog.Title>
                <Dialog.Description>Alles an einem Ort.</Dialog.Description>
              </div>
              <Dialog.Close
                className="app-sheet-close"
                aria-label="Menü schließen"
              >
                <X size={20} />
              </Dialog.Close>
            </div>
            <label className="workspace-search app-menu-search"><Search size={18} /><input type="search" aria-label="Bereiche suchen" placeholder="Wohin möchtest du?" value={suche} onChange={e => setSuche(e.target.value)} /></label>
            <nav className="app-menu-groups" aria-label="Weitere Bereiche">
              {navigationGroups.map(group => {
                const entries = shown.filter(n => n.group === group);
                return entries.length > 0 && <section key={group}>
                  <h3>{group}</h3>
                  <div className="app-sheet-grid">{entries.map(n => <Link key={n.href} href={n.href} onClick={() => setMehr(false)} aria-current={location === n.href ? "page" : undefined} data-tone={n.tone}>
                    <n.icon size={20} aria-hidden="true" /><span>{n.label}</span><ArrowUpRight size={14} aria-hidden="true" />
                  </Link>)}</div>
                </section>;
              })}
              {shown.length === 0 && <p className="workspace-muted">Kein Bereich passt zu deiner Suche.</p>}
            </nav>
            <button type="button" className="app-sheet-logout" onClick={logout}>
              <LogOut size={17} aria-hidden="true" />
              Abmelden
            </button>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
