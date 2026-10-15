import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PhoneIncoming, Phone, Search, RefreshCw, ArrowLeft, ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { Seite, Karte, Chip } from "@/components/seite";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const statuses = { neu: "Neu", in_bearbeitung: "In Bearbeitung", erledigt: "Erledigt", archiviert: "Archiviert" } as const;
type Status = keyof typeof statuses;
type Enquiry = {
  id: number; nummer: string; status: Status; kategorie: string; zusammenfassung: string;
  details: Record<string, string>; weitergabe: string; auswertung: string; notiz: string;
  email_status: string; beendet_am: string | null; created_at: string; updated_at: string;
};
const labels: Record<string, string> = { name: "Name", unternehmen: "Unternehmen", leistungen: "Leistungen", wuensche: "Wünsche & Funktionen", website: "Bestehende Website", zeitrahmen: "Zeitrahmen", budget: "Budget", rueckruf: "Rückrufwunsch", email: "E-Mail", offeneFragen: "Noch zu klären" };
async function request(path: string, options?: RequestInit) {
  const token = localStorage.getItem("lukas_token");
  const response = await fetch(`${BASE}/api/telefon/anfragen${path}`, {
    ...options, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options?.headers },
  });
  if (!response.ok) throw new Error(response.status === 401 ? "Bitte erneut anmelden." : "Telefonanfragen konnten nicht aktualisiert werden.");
  return response.json();
}
const date = (value: string) => new Date(value).toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "medium", timeStyle: "short" });
function EnquiryCard({ row }: { row: Enquiry }) {
  const client = useQueryClient();
  const [note, setNote] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: (data: { status?: Status; notiz?: string }) => request(`/${row.id}`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: (_data, variables) => { if (variables.notiz !== undefined) setNote(null); void client.invalidateQueries({ queryKey: ["telefonanfragen"] }); },
  });
  const number = /^[1-9]\d{5,14}$/.test(row.nummer) ? "+" + row.nummer : "";
  const fields = Object.entries(labels).filter(([key]) => row.details[key]);
  return <Karte>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">Anruf #{row.id} · {date(row.created_at)} Uhr</p>
        <h2 className="mt-1 text-lg font-semibold break-words">{row.details.unternehmen || row.details.name || number || "Unbekannter Anrufer"}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{number || "Rufnummer nicht übermittelt"}</p>
      </div>
      <Chip ton={row.status === "neu" ? "info" : row.status === "erledigt" ? "gut" : "neutral"}>{statuses[row.status]}</Chip>
    </div>
    <div className="mt-4 flex flex-wrap gap-2">
      <Chip>{row.kategorie === "anfrage" ? "Geschäftsanfrage" : row.kategorie === "sonstiges" ? "Sonstiger Anruf" : "Anliegen noch offen"}</Chip>
      {row.auswertung === "laeuft" && <Chip ton="info">{Date.now() - new Date(row.updated_at).getTime() > 180000 ? "Abschluss ausstehend" : "Wird erfasst"}</Chip>}
      {row.auswertung === "fehler" && <Chip ton="warnung">Auswertung unvollständig</Chip>}
      {row.email_status === "akzeptiert" && <Chip ton="gut">E-Mail vom Mailserver angenommen</Chip>}
      {row.email_status === "fehler" && <Chip ton="warnung">E-Mail nicht bestätigt</Chip>}
      {row.email_status === "sendet" && <Chip ton="warnung">E-Mail-Bestätigung ausstehend</Chip>}
    </div>
    {row.zusammenfassung && <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-relaxed">{row.zusammenfassung}</p>}
    {row.weitergabe !== "erlaubt" && <p className="mt-4 text-sm text-muted-foreground">{row.weitergabe === "abgelehnt" ? "Der Anrufer hat die Weitergabe abgelehnt. Es werden keine Anfragedetails weitergegeben." : "Die Freigabe zur Weitergabe der Anfragedaten ist noch offen."}</p>}
    {fields.length > 0 && <dl className="mt-4 grid gap-3 sm:grid-cols-2">{fields.map(([key, label]) => <div key={key} className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-sm">{row.details[key]}</dd></div>)}</dl>}
    {row.auswertung === "fehler" && <p className="mt-3 text-sm text-amber-300">Die automatische Notiz konnte nicht vollständig erstellt werden. Vorhandene Angaben können unvollständig sein.</p>}
    <div className="mt-5 flex flex-wrap items-center gap-3">
      {number && <Button asChild size="sm" variant="outline"><a href={`tel:${number}`} aria-label={`Rückruf ${number}`}><Phone size={14} className="mr-2" />Rückruf</a></Button>}
      <label className="flex items-center gap-2 text-sm">Status
        <select aria-label={`Status Anfrage ${row.id}`} className="rounded-lg border border-white/10 bg-background p-2 text-sm" value={row.status} disabled={mutation.isPending} onChange={e => mutation.mutate({ status: e.target.value as Status })}>
          {Object.entries(statuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </label>
    </div>
    <details className="mt-4 text-sm"><summary className="cursor-pointer text-muted-foreground">Interne Notiz{row.notiz ? " vorhanden" : " hinzufügen"}</summary>
      <label className="mt-3 block" htmlFor={`note-${row.id}`}>Deine Notiz</label>
      <Textarea id={`note-${row.id}`} className="mt-2" maxLength={5000} value={note ?? row.notiz} onChange={e => setNote(e.target.value)} />
      <Button size="sm" className="mt-2" disabled={note === null || mutation.isPending} onClick={() => mutation.mutate({ notiz: note ?? row.notiz })}>Notiz speichern</Button>
    </details>
    {mutation.isError && <p role="alert" className="mt-3 text-sm text-destructive">Änderung nicht gespeichert. Bitte erneut versuchen.</p>}
  </Karte>;
}
export default function Telefonanfragen() {
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const query = useQuery<{ rows: Enquiry[]; total: number }>({
    queryKey: ["telefonanfragen", status, search, offset],
    queryFn: () => request(`?${new URLSearchParams({ ...(status ? { status } : {}), q: search, offset: String(offset) })}`),
    refetchInterval: 15000,
  });
  return <Seite icon={PhoneIncoming} titel="Telefonanfragen" unterzeile="Wer hat angerufen, was wird gebraucht und was ist noch offen?" aktionen={<Button size="sm" variant="outline" onClick={() => void query.refetch()}><RefreshCw size={15} className="mr-2" />Aktualisieren</Button>}>
    <div className="flex flex-col gap-3 sm:flex-row">
      <label className="workspace-search flex-1"><Search size={18} /><input type="search" aria-label="Telefonanfragen suchen" placeholder="Name, Rufnummer oder Anliegen suchen" maxLength={200} value={search} onChange={e => { setSearch(e.target.value); setOffset(0); }} /></label>
      <select aria-label="Anfragen nach Status filtern" className="rounded-xl border border-white/10 bg-background p-3 text-sm" value={status} onChange={e => { setStatus(e.target.value); setOffset(0); }}><option value="">Alle Status</option>{Object.entries(statuses).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select>
    </div>
    <p className="text-xs text-muted-foreground">{query.data ? `${query.data.total} Anrufe` : "Anfragen werden geladen"} · Zeiten in Deutschland · <Link className="underline" href="/telefon">Zum Anrufprotokoll</Link></p>
    {query.isPending && <p role="status">Telefonanfragen werden geladen …</p>}
    {query.isError && <p role="alert" className="text-destructive">{query.error.message}</p>}
    {query.data?.total === 0 && <Karte><h2 className="font-semibold">Noch keine passenden Telefonanfragen</h2><p className="mt-2 text-sm text-muted-foreground">Neue eingehende Anrufe erscheinen hier automatisch. Bestätigte Kundenwünsche und Rückrufdaten werden zu einer Anfrage zusammengefasst. Frühere Anrufe bleiben im Anrufprotokoll.</p></Karte>}
    {query.data?.rows.map(row => <EnquiryCard key={row.id} row={row} />)}
    {(query.data?.total ?? 0) > 50 && <div className="flex items-center justify-between"><Button variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}><ArrowLeft size={15} className="mr-2" />Zurück</Button><span className="text-sm">Seite {Math.floor(offset / 50) + 1}</span><Button variant="outline" disabled={offset + 50 >= (query.data?.total ?? 0)} onClick={() => setOffset(offset + 50)}>Weiter<ArrowRight size={15} className="ml-2" /></Button></div>}
    <p className="text-xs text-muted-foreground">Automatisch erstellte Gesprächsnotizen bitte vor einem verbindlichen Angebot prüfen. Hier werden Anfragedaten gespeichert, keine Audioaufnahmen.</p>
  </Seite>;
}
