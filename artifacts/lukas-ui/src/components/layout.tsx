import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import * as Dialog from "@radix-ui/react-dialog";
import { useHealthCheck } from "@workspace/api-client-react";
import { Fehlergrenze } from "@/components/fehlergrenze";
import {
  BarChart3,
  KeyRound,
  Brain,
  Target,
  BookOpen,
  MessageSquare,
  Film,
  LogOut,
  AlertTriangle,
  ShieldCheck,
  Lightbulb,
  Plug,
  Inbox,
  Network,
  X,
  Phone,
  House,
  Grid2X2,
  ArrowUpRight,
} from "lucide-react";
import "./app-shell.css";

const navigation = [
  { href: "/", label: "Heute", icon: House },
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/gehirn", label: "Gehirn", icon: Network },
  { href: "/memory", label: "Gedächtnis", icon: Brain },
  { href: "/goals", label: "Ziele", icon: Target },
  { href: "/diary", label: "Tagebuch", icon: BookOpen },
  { href: "/studio", label: "Studio", icon: Film },
  { href: "/meldungen", label: "Meldungen", icon: Inbox },
  { href: "/proposals", label: "Vorschläge", icon: Lightbulb },
  { href: "/approvals", label: "Freigaben", icon: ShieldCheck },
  { href: "/mcp", label: "Verbindungen", icon: Plug },
  { href: "/telefon", label: "Telefon", icon: Phone },
  { href: "/kennzahlen", label: "Kennzahlen", icon: BarChart3 },
  { href: "/zugaenge", label: "Zugänge", icon: KeyRound },
  { href: "/diagnostics", label: "Diagnose", icon: AlertTriangle },
];
export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: health, isError: healthError } = useHealthCheck();
  const [mehr, setMehr] = useState(false);
  const shell = useRef<HTMLDivElement>(null),
    scroll = useRef<HTMLDivElement>(null);
  const title = navigation.find((n) => n.href === location)?.label ?? "Lukas";
  const online = !healthError && health?.status === "ok";
  useEffect(() => {
    setMehr(false);
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
    <div ref={shell} className="app-shell">
      <aside className="app-sidebar" aria-label="Desktop-Navigation">
        <Link href="/" className="app-brand">
          <span className="app-monogram">L</span>
          <span>
            Lukas<small>Dein persönlicher Assistent</small>
          </span>
        </Link>
        <p className="app-nav-heading">DEIN RAUM</p>
        <nav>
          {navigation.map((n, i) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={location === n.href ? "page" : undefined}
              className={`app-sidebar-link ${i === 7 ? "app-nav-divider" : ""}`}
            >
              <n.icon size={18} aria-hidden="true" />
              {n.label}
              {location === n.href && <span className="app-nav-dot" />}
            </Link>
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
      <main className="app-main">
        <div className="app-scroll" ref={scroll}>
          <Fehlergrenze schluessel={location}>{children}</Fehlergrenze>
        </div>
      </main>
      <Dialog.Root open={mehr} onOpenChange={setMehr}>
        <nav className="app-tabbar" aria-label="Hauptnavigation">
          {navigation.slice(0, 3).map((n) => (
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
                !navigation.slice(0, 3).some((n) => n.href === location)
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
            <nav className="app-sheet-grid" aria-label="Weitere Bereiche">
              {navigation.slice(3).map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  onClick={() => setMehr(false)}
                  aria-current={location === n.href ? "page" : undefined}
                >
                  <n.icon size={20} aria-hidden="true" />
                  <span>{n.label}</span>
                  <ArrowUpRight size={14} aria-hidden="true" />
                </Link>
              ))}
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
