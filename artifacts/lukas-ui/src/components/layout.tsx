import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useHealthCheck } from "@workspace/api-client-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { Fehlergrenze } from "@/components/fehlergrenze";
import {
  Activity,
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
  Menu,
  X, Phone } from "lucide-react";

function handleLogout() {
  localStorage.removeItem("lukas_token");
  window.location.reload();
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: health } = useHealthCheck();
  const isMobile = useIsMobile();
  const [navOpen, setNavOpen] = useState(false);

  // Beim Wechseln der Seite (oder Wechsel Mobil/Desktop) die Drawer schliessen.
  useEffect(() => {
    setNavOpen(false);
  }, [location, isMobile]);

  const navItems = [
    { href: "/", label: "Übersicht", icon: Activity },
    { href: "/chat", label: "Chat", icon: MessageSquare },
    { href: "/studio", label: "Studio", icon: Film },
    { href: "/memory", label: "Gedächtnis", icon: Brain },
    { href: "/gehirn", label: "Gehirn", icon: Network },
    { href: "/goals", label: "Ziele", icon: Target },
    { href: "/diary", label: "Tagebuch", icon: BookOpen },
    { href: "/meldungen", label: "Meldungen", icon: Inbox },
    { href: "/proposals", label: "Vorschläge", icon: Lightbulb },
    { href: "/approvals", label: "Freigaben", icon: ShieldCheck },
    { href: "/mcp", label: "MCP", icon: Plug },
    { href: "/telefon", label: "Telefon", icon: Phone },
    { href: "/kennzahlen", label: "Kennzahlen", icon: BarChart3 },
    { href: "/zugaenge", label: "Zugänge", icon: KeyRound },
    { href: "/diagnostics", label: "Diagnose", icon: AlertTriangle },
  ];

  const sidebarContent = (
    <>
      <div className="flex h-16 items-center gap-3 px-5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-primary/12">
          <span className="text-sm font-semibold text-primary">L</span>
        </div>
        <div className="flex flex-col min-w-0">
          <span className="font-semibold tracking-tight leading-tight">Lukas</span>
          <span className="text-xs text-muted-foreground flex items-center gap-1.5 leading-tight">
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${health?.status === 'ok' ? 'bg-emerald-400' : 'bg-red-400'}`} />
            {health?.status === 'ok' ? 'online' : 'offline'}
          </span>
        </div>
        {isMobile && (
          <button
            onClick={() => setNavOpen(false)}
            className="ml-auto text-muted-foreground hover:text-foreground"
            aria-label="Menü schliessen"
            data-testid="button-close-nav"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto p-3 space-y-0.5">
        {navItems.map((item) => {
          const isActive = location === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              /*
               * Der aktive Eintrag ist jetzt an einem farbigen Balken links zu
               * erkennen, nicht nur an einem grauen Kasten — und das Icon
               * nimmt die Akzentfarbe an. Ohne Farbe sah die Navigation aus
               * wie eine Dateiliste.
               */
              className={`relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-200 ${
                isActive
                  ? "bg-primary/10 text-foreground font-medium"
                  : "text-muted-foreground hover:bg-white/[0.05] hover:text-foreground"
              }`}
            >
              {isActive && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r-full bg-primary" />
              )}
              <item.icon
                className={`w-4 h-4 shrink-0 transition-colors ${isActive ? "text-primary" : ""}`}
              />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="p-4">
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted-foreground transition-colors duration-200 hover:bg-white/[0.05] hover:text-foreground"
          data-testid="button-logout"
        >
          <LogOut className="w-4 h-4 shrink-0" />
          Abmelden
        </button>
      </div>
    </>
  );

  return (
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden font-sans">
      {isMobile ? (
        <>
          {/* Mobile: schmale Top-Bar mit Menü-Button statt fixer Sidebar */}
          <div className="glass fixed inset-x-0 top-0 z-30 flex h-14 items-center gap-3 border-x-0 border-t-0 px-4">
            <button
              onClick={() => setNavOpen(true)}
              className="text-foreground"
              aria-label="Menü öffnen"
              data-testid="button-open-nav"
            >
              <Menu className="w-6 h-6" />
            </button>
            <span className="font-semibold tracking-tight">Lukas</span>
            <span className={`inline-block w-1.5 h-1.5 rounded-full ml-auto ${health?.status === 'ok' ? 'bg-emerald-400' : 'bg-red-400'}`} />
          </div>

          {navOpen && (
            <div
              className="fixed inset-0 z-40 bg-black/60"
              onClick={() => setNavOpen(false)}
              data-testid="overlay-nav-backdrop"
            />
          )}
          <aside
            className={`fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-sidebar transition-transform duration-200 ${
              navOpen ? "translate-x-0" : "-translate-x-full"
            }`}
          >
            {sidebarContent}
          </aside>

          <main className="flex-1 min-w-0 flex flex-col h-full overflow-hidden relative pt-14">
            <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden">
              <Fehlergrenze schluessel={location}>{children}</Fehlergrenze>
            </div>
          </main>
        </>
      ) : (
        <>
          <aside className="flex w-64 flex-shrink-0 flex-col bg-sidebar">
            {sidebarContent}
          </aside>

          <main className="flex-1 min-w-0 flex flex-col h-full overflow-hidden relative">
            <div className="flex-1 min-w-0 overflow-y-auto">
              <Fehlergrenze schluessel={location}>{children}</Fehlergrenze>
            </div>
          </main>
        </>
      )}
    </div>
  );
}
