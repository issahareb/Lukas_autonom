import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import * as Dialog from "@radix-ui/react-dialog";
import { useHealthCheck } from "@workspace/api-client-react";
import { Fehlergrenze } from "@/components/fehlergrenze";
import { LukasAvatar } from "@/components/lukas-avatar";
import { LogOut, X, Grid2X2, Menu, ArrowUpRight, Search, ChevronRight } from "lucide-react";
import { navigation, navigationGroups } from "@/lib/navigation";
import { AppNavigationContext } from "./app-navigation";
import "./app-shell.css";
import "./workspace.css";
import "./app-motion.css";
import "./hareb-shell.css";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: health, isError: healthError } = useHealthCheck();
  const [mehr, setMehr] = useState(false);
  const [suche, setSuche] = useState("");
  const menuOpener = useRef<HTMLElement | null>(null);
  const openMenu = () => {
    menuOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setMehr(true);
  };
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
    <AppNavigationContext.Provider value={openMenu}>
    <div ref={shell} className="app-shell" data-tone={current?.tone ?? "mint"} data-page={location}>
      <aside className="app-sidebar" aria-label="Desktop-Navigation">
        <Link href="/" className="app-brand">
          <LukasAvatar className="app-brand-image" />
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
        <button type="button" className="app-menu-toggle" aria-label="Menü öffnen" aria-expanded={mehr} aria-haspopup="dialog" onClick={openMenu}><Menu size={22} /></button>
        <Link href="/" className="app-mobile-brand">
          <LukasAvatar className="app-brand-image" />
          {location === "/chat" || location === "/" ? "Lukas" : title}
        </Link>
        {status}
      </header>
      <main className="app-main" id="arbeitsbereich">
        <div className="app-topbar">
          <span className="app-breadcrumb">Lukas <ChevronRight size={13} /> {current?.group} <ChevronRight size={13} /> <strong>{title}</strong></span>
          <button type="button" className="app-jump" onClick={openMenu}><Search size={15} /> Bereich wechseln <Grid2X2 size={14} /></button>
        </div>
        <div className="app-scroll" ref={scroll}>
          <div className="app-route" key={location}><Fehlergrenze schluessel={location}>{children}</Fehlergrenze></div>
        </div>
      </main>
      <Dialog.Root open={mehr} onOpenChange={setMehr}>
        <Dialog.Portal>
          <Dialog.Overlay className="app-sheet-overlay" />
          <Dialog.Content className="app-sheet app-drawer" onCloseAutoFocus={event => {
            event.preventDefault();
            if (menuOpener.current?.isConnected) menuOpener.current.focus();
            else shell.current?.querySelector<HTMLButtonElement>(".app-menu-toggle")?.focus();
          }}>
            <div className="app-sheet-handle" aria-hidden="true" />
            <div className="app-sheet-heading">
              <div>
                <LukasAvatar className="app-menu-avatar" />
                <Dialog.Title>Lukas</Dialog.Title>
                <Dialog.Description>Hareb Digital / Dein Arbeitsraum</Dialog.Description>
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
    </AppNavigationContext.Provider>
  );
}
