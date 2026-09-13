/*
 * Die Freigabe-Seite.
 *
 * Von allen Oberflaechen hier ist das die, bei der ein Fehler nicht nur haesslich
 * ist. Wer "Erlauben" drueckt, autorisiert eine Aktion, die Lukas sonst nicht
 * ausfuehren darf — eine Mail an einen Kunden, ein Befehl auf dem Droplet. Geht
 * dabei die falsche ID raus oder das falsche Verb, hat Issa etwas freigegeben,
 * das er nie gesehen hat, und haelt gleichzeitig etwas fuer erledigt, das noch
 * offen ist.
 *
 * Deshalb pruefen die Tests hier nicht, ob es huebsch aussieht, sondern was
 * tatsaechlich ueber die Leitung geht.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import Approvals from "./approvals";

type Ruf = { url: string; init?: RequestInit };

function mitFreigaben(rows: unknown[]): Ruf[] {
  const rufe: Ruf[] = [];
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    rufe.push({ url: String(url), init });
    // Entscheidungen antworten leer; die Liste antwortet mit den Zeilen.
    const body = String(url).includes("/allow") || String(url).includes("/deny") ? {} : rows;
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });
  return rufe;
}

const offen = {
  id: 42,
  conversationId: 1,
  tool: "email_send",
  riskTier: "R3",
  argumentsPreview: 'an: "kunde@example.com"\nbetreff: "Angebot"',
  status: "pending" as const,
  createdAt: new Date().toISOString(),
  decidedAt: null,
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  expired: false,
};

describe("Freigaben", () => {
  it("zeigt die offene Freigabe mit Werkzeug, Stufe und den echten Argumenten", async () => {
    mitFreigaben([offen]);
    render(<Approvals />);

    expect(await screen.findByText("email_send")).toBeInTheDocument();
    /*
     * Geprueft wird das WORT, nicht der Code: in der Oberflaeche steht jetzt
     * "riskant" statt "R3". Wer eine Freigabe erteilt, soll lesen koennen,
     * worauf er sich einlaesst, ohne eine Stufentabelle im Kopf zu haben.
     */
    expect(screen.getByText("riskant")).toBeInTheDocument();
    /*
     * Die Argumente muessen SICHTBAR sein. Eine Freigabe, bei der man nur den
     * Werkzeugnamen sieht, ist eine Unterschrift auf einem leeren Blatt.
     */
    expect(screen.getByText(/kunde@example\.com/)).toBeInTheDocument();
  });

  it("schickt beim Erlauben die richtige ID an den richtigen Pfad", async () => {
    const rufe = mitFreigaben([offen]);
    render(<Approvals />);
    await screen.findByText("email_send");

    await userEvent.click(screen.getByRole("button", { name: /Erlauben/ }));

    await waitFor(() => {
      const entscheidung = rufe.find((r) => r.init?.method === "POST");
      expect(entscheidung?.url).toBe("/api/lukas/approvals/42/allow");
    });
  });

  it("schickt beim Ablehnen deny, nicht allow", async () => {
    const rufe = mitFreigaben([offen]);
    render(<Approvals />);
    await screen.findByText("email_send");

    await userEvent.click(screen.getByRole("button", { name: /Ablehnen/ }));

    await waitFor(() => {
      const entscheidung = rufe.find((r) => r.init?.method === "POST");
      expect(entscheidung?.url).toBe("/api/lukas/approvals/42/deny");
    });
    expect(rufe.every((r) => !r.url.includes("/allow"))).toBe(true);
  });

  it("nimmt den Token mit — sonst antwortet der Server 401 und nichts passiert", async () => {
    localStorage.setItem("lukas_token", "geheim-123");
    const rufe = mitFreigaben([offen]);
    render(<Approvals />);
    await screen.findByText("email_send");

    await userEvent.click(screen.getByRole("button", { name: /Erlauben/ }));

    await waitFor(() => {
      const entscheidung = rufe.find((r) => r.init?.method === "POST");
      const kopf = entscheidung?.init?.headers as Record<string, string> | undefined;
      expect(kopf?.Authorization).toBe("Bearer geheim-123");
    });
  });

  it("lädt nach der Entscheidung neu, statt einen alten Stand stehen zu lassen", async () => {
    const rufe = mitFreigaben([offen]);
    render(<Approvals />);
    await screen.findByText("email_send");
    const vorher = rufe.filter((r) => r.init?.method !== "POST").length;

    await userEvent.click(screen.getByRole("button", { name: /Erlauben/ }));

    await waitFor(() => {
      expect(rufe.filter((r) => r.init?.method !== "POST").length).toBeGreaterThan(vorher);
    });
  });

  /*
   * Eine abgelaufene Freigabe darf keine Tasten mehr haben.
   *
   * Der Server lehnt sie ohnehin ab. Der Schaden waere nicht technisch,
   * sondern menschlich: Issa klickt "Erlauben", sieht keinen Fehler und geht
   * davon aus, Lukas koenne jetzt weiterarbeiten. Tatsaechlich wartet der
   * weiter — und niemand weiss, worauf.
   */
  it("bietet bei einer abgelaufenen Freigabe keine Tasten mehr an", async () => {
    mitFreigaben([{ ...offen, expired: true }]);
    render(<Approvals />);

    await screen.findByText("email_send");
    expect(screen.queryByRole("button", { name: /Erlauben/ })).not.toBeInTheDocument();
    expect(screen.getByText("abgelaufen")).toBeInTheDocument();
  });

  it("sagt deutlich, wenn nichts offen ist", async () => {
    mitFreigaben([]);
    render(<Approvals />);
    expect(await screen.findByText(/Nichts offen/)).toBeInTheDocument();
  });

  it("verschweigt einen Ladefehler nicht", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("nope", { status: 500 })));
    render(<Approvals />);
    expect(await screen.findByText(/liessen sich nicht laden/)).toBeInTheDocument();
  });
});
