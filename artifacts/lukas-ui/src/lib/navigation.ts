import { House, MessageSquare, Phone, Network, Brain, Target, BookOpen, Film, Inbox, Lightbulb, ShieldCheck, Plug, BarChart3, KeyRound, AlertTriangle } from "lucide-react";

export const navigation = [
  { href: "/", label: "Übersicht", icon: House, group: "Arbeitsraum", tone: "mint" },
  { href: "/chat", label: "Chat", icon: MessageSquare, group: "Arbeitsraum", tone: "mint" },
  { href: "/telefon", label: "Telefon", icon: Phone, group: "Arbeitsraum", tone: "cyan" },
  { href: "/goals", label: "Ziele", icon: Target, group: "Arbeitsraum", tone: "mint" },
  { href: "/studio", label: "Studio", icon: Film, group: "Arbeitsraum", tone: "rose" },
  { href: "/gehirn", label: "Gehirn", icon: Network, group: "Wissen", tone: "violet" },
  { href: "/memory", label: "Gedächtnis", icon: Brain, group: "Wissen", tone: "violet" },
  { href: "/diary", label: "Tagebuch", icon: BookOpen, group: "Wissen", tone: "violet" },
  { href: "/approvals", label: "Freigaben", icon: ShieldCheck, group: "Entscheidungen", tone: "amber" },
  { href: "/meldungen", label: "Meldungen", icon: Inbox, group: "Entscheidungen", tone: "amber" },
  { href: "/proposals", label: "Vorschläge", icon: Lightbulb, group: "Entscheidungen", tone: "amber" },
  { href: "/mcp", label: "Verbindungen", icon: Plug, group: "System", tone: "cyan" },
  { href: "/kennzahlen", label: "Kennzahlen", icon: BarChart3, group: "System", tone: "mint" },
  { href: "/zugaenge", label: "Zugänge", icon: KeyRound, group: "System", tone: "cyan" },
  { href: "/diagnostics", label: "Diagnose", icon: AlertTriangle, group: "System", tone: "cyan" },
] as const;
export const navigationGroups = ["Arbeitsraum", "Wissen", "Entscheidungen", "System"] as const;
export const mobileNavigation = ["/", "/chat", "/telefon", "/approvals"];
