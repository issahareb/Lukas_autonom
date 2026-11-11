import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { TerminalSquare, Loader2, Eye, EyeOff } from "lucide-react";

const STORAGE_KEY = "lukas_token";

async function verifyToken(token: string | null): Promise<boolean> {
  const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
  try {
    const res = await fetch("/api/lukas/status", { headers });
    return res.ok;
  } catch {
    throw new Error("network");
  }
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<"checking" | "ok" | "login">("checking");
  const [tokenInput, setTokenInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [reveal, setReveal] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    verifyToken(stored)
      .then((ok) => setStatus(ok ? "ok" : "login"))
      .catch(() => setStatus("login"));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const ok = await verifyToken(tokenInput.trim());
      if (ok) {
        localStorage.setItem(STORAGE_KEY, tokenInput.trim());
        setStatus("ok");
      } else {
        setError(
          "Falscher Zugangscode. Tipp: Klick auf das Auge-Symbol, um zu sehen, was du " +
            "eingetippt hast — oft schleicht sich beim Kopieren ein Leerzeichen ein, oder " +
            "es wurde versehentlich der ELEVENLABS_LLM_TOKEN statt LUKAS_API_TOKEN eingetragen.",
        );
      }
    } catch {
      setError("Verbindung zu Lukas fehlgeschlagen — kurz nochmal versuchen.");
    } finally {
      setSubmitting(false);
    }
  }

  if (status === "checking") {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background text-foreground">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (status === "login") {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background text-foreground p-4">
        <Card className="w-full max-w-sm">
          <CardHeader className="items-center text-center">
            <TerminalSquare className="w-8 h-8 text-foreground mb-2" />
            <CardTitle className="text-2xl">Lukas</CardTitle>
            <CardDescription>Zugangscode eingeben, um fortzufahren</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="relative">
                <Input
                  type={reveal ? "text" : "password"}
                  autoFocus
                  placeholder="Zugangscode"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  autoComplete="off"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  className="pr-10"
                  data-testid="input-access-token"
                />
                <button
                  type="button"
                  onClick={() => setReveal((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={reveal ? "Zugangscode verbergen" : "Zugangscode anzeigen"}
                  data-testid="button-toggle-reveal-token"
                >
                  {reveal ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {tokenInput && (
                <p className="text-xs text-muted-foreground">{tokenInput.length} Zeichen eingegeben</p>
              )}
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <Button type="submit" className="w-full" disabled={submitting || !tokenInput.trim()}>
                {submitting ? "Prüfe…" : "Anmelden"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
