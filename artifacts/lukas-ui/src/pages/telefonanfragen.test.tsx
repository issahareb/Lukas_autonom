import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import Telefonanfragen from "./telefonanfragen";
const row = { id: 7, nummer: "4915100000001", status: "neu", kategorie: "anfrage", zusammenfassung: "Website mit Terminbuchung gewünscht", details: { name: "Max", unternehmen: "Musterfirma", wuensche: "Terminbuchung" }, weitergabe: "erlaubt", auswertung: "fertig", notiz: "", email_status: "fehler", beendet_am: "2026-10-15T17:00:00Z", created_at: "2026-10-15T16:55:00Z", updated_at: "2026-10-15T17:00:00Z" };
function setup(rows = [row], patchStatus=200) {
  const calls: {url:string; init?:RequestInit}[] = [];
  vi.stubGlobal("fetch", async (url:string, init?:RequestInit) => { calls.push({url:String(url),init}); return Response.json(init?.method === "PATCH" ? {ok:patchStatus===200} : {rows,total:rows.length}, {status:init?.method === "PATCH" ? patchStatus : 200}); });
  const client = new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
  render(<QueryClientProvider client={client}><Telefonanfragen /></QueryClientProvider>);
  return calls;
}
describe("Telefonanfragen", () => {
  it("shows caller, time, wishes and mail failure; status is editable", async () => {
    const calls=setup();
    expect(await screen.findByRole("heading", {name:"Musterfirma"})).toBeVisible();
    expect(screen.getByText("Website mit Terminbuchung gewünscht")).toBeVisible();
    expect(screen.getByRole("link",{name:/Rückruf/})).toHaveAttribute("href","tel:+4915100000001");
    expect(screen.getByText("E-Mail nicht bestätigt")).toBeVisible();
    await userEvent.selectOptions(screen.getByLabelText("Status Anfrage 7"),"in_bearbeitung");
    await waitFor(()=>expect(calls.some(c=>c.init?.method==="PATCH")).toBe(true));
    expect(JSON.parse(String(calls.find(c=>c.init?.method==="PATCH")?.init?.body))).toEqual({status:"in_bearbeitung"});
  });
  it("preserves notes and shows error when saving fails", async () => {
    setup([row],500); await screen.findByRole("heading", {name:"Musterfirma"});
    await userEvent.click(screen.getByText("Interne Notiz hinzufügen"));
    await userEvent.type(screen.getByLabelText("Deine Notiz"),"Morgen zurückrufen");
    await userEvent.click(screen.getByRole("button",{name:"Notiz speichern"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("Änderung nicht gespeichert");
    expect(screen.getByLabelText("Deine Notiz")).toHaveValue("Morgen zurückrufen");
  });
  it("anonymous callers have no invented callback link", async () => {
    setup([{...row,nummer:"",details:{name:"",unternehmen:"",wuensche:""}}]);
    await screen.findByText("Unbekannter Anrufer");
    expect(screen.queryByRole("link",{name:/Rückruf/})).toBeNull();
  });
  it("empty state explains new calls and keeps access to earlier call records", async () => {
    setup([]);expect(await screen.findByText("Noch keine passenden Telefonanfragen")).toBeVisible();
    expect(screen.getByRole("link",{name:"Zum Anrufprotokoll"})).toHaveAttribute("href","/telefon");
  });
});
