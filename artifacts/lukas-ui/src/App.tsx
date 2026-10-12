import { Suspense, lazy } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";
import { AuthGate } from "@/components/auth-gate";
import NotFound from "@/pages/not-found";

import Dashboard from "@/pages/dashboard";
const Chat = lazy(() => import("@/pages/chat"));
import Memory from "@/pages/memory";
import Goals from "@/pages/goals";
import Diary from "@/pages/diary";
import Studio from "@/pages/studio";
import Diagnostics from "@/pages/diagnostics";
import Approvals from "@/pages/approvals";
import Proposals from "@/pages/proposals";
import Meldungen from "@/pages/meldungen";
import Kennzahlen from "@/pages/kennzahlen";
import Zugaenge from "@/pages/zugaenge";
/*
 * Die 3D-Ansicht bringt three.js mit — eine halbe Megabyte, die niemand
 * laden soll, der nur in den Chat will. Deshalb erst beim Öffnen des Tabs.
 */
const Gehirn = lazy(() => import("@/pages/gehirn"));
import Mcp from "@/pages/mcp";
import Telefon from "@/pages/telefon";

const queryClient = new QueryClient();

function Router() {
  return (
    <Layout>
      <Suspense
        fallback={<div className="p-6 text-sm text-muted-foreground">Lädt…</div>}
      >
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/chat" component={Chat} />
        <Route path="/memory" component={Memory} />
        <Route path="/gehirn" component={Gehirn} />
        <Route path="/goals" component={Goals} />
        <Route path="/diary" component={Diary} />
        <Route path="/studio" component={Studio} />
        <Route path="/approvals" component={Approvals} />
        <Route path="/meldungen" component={Meldungen} />
        <Route path="/proposals" component={Proposals} />
        <Route path="/mcp" component={Mcp} />
        <Route path="/telefon" component={Telefon} />
        <Route path="/kennzahlen" component={Kennzahlen} />
        <Route path="/zugaenge" component={Zugaenge} />
        <Route path="/diagnostics" component={Diagnostics} />
        <Route component={NotFound} />
      </Switch>
      </Suspense>
    </Layout>
  );
}

function App() {
  return (
    <AuthGate>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </AuthGate>
  );
}

export default App;
