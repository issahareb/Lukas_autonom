import { useState, useRef, useEffect, useCallback, useLayoutEffect } from "react";
import {
  useListAnthropicConversations,
  useCreateAnthropicConversation,
  useDeleteAnthropicConversation,
  useGetAnthropicConversation,
  getListAnthropicConversationsQueryKey,
  getGetAnthropicConversationQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Plus, Trash2, ArrowUp, MessageSquare, Loader2, ArrowLeft,
  Paperclip, X, FileText, Film, ImageIcon, File as FileIcon, ArrowDown, Square,
} from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { takeCompleteLines, parseSseData } from "@/lib/sse";
import { warteSchritt, GEDULD_MS } from "@/lib/geduld";
import { ToolSteps, type ToolStep } from "@/components/tool-steps";
import { VoicePanel } from "@/components/voice-panel";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Attachment = {
  id: number;
  messageId: number | null;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  kind: "image" | "pdf" | "text" | "video" | "other";
  url: string;
};

function attachmentIcon(kind: Attachment["kind"]) {
  if (kind === "image") return ImageIcon;
  if (kind === "video") return Film;
  if (kind === "pdf" || kind === "text") return FileText;
  return FileIcon;
}

function formatSize(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function chatTime(iso: string) {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  return sameDay ? time : `${d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })} ${time}`;
}

function relativeDay(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const days = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (days === 0) return "Heute";
  if (days === 1) return "Gestern";
  if (days < 7) return `vor ${days} Tagen`;
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function renderWithLinks(text: string) {
  return text.split(/(https?:\/\/[^\s]+)/g).map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a key={i} href={part} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2 break-all hover:opacity-80">
        {part}
      </a>
    ) : <span key={i}>{part}</span>,
  );
}

/*
 * Eine Sprechblase — Lukas links am Rand, Issa rechts am Rand.
 *
 * Zwei Dinge standen dem vorher im Weg. Erstens hatte nur Issa eine Blase;
 * Lukas' Antworten standen als nackter Text ueber die volle Breite und lasen
 * sich wie ein Ausgabe-Log. Zweitens sass neben jeder Blase ein Avatar-Kreis
 * und hat sie um dessen Breite von der Kante weggeschoben — genau die Kante,
 * an der sie kleben soll.
 *
 * Deshalb: keine Avatare mehr. In einem Gespraech zwischen genau zwei Leuten
 * sagt die Seite bereits, wer spricht — so macht es auch jeder Messenger.
 *
 * 85% Maximalbreite, weil eine Blase ueber die ganze Breite optisch keine
 * Seite mehr hat.
 */
function Bubble({
  own,
  zeit,
  wartet,
  children,
}: {
  own: boolean;
  zeit?: string;
  wartet?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`flex flex-col min-w-0 animate-in fade-in duration-300 ${
        own ? "items-end slide-in-from-right-3" : "items-start slide-in-from-left-3"
      }`}
    >
      <div
        className={`max-w-[85%] min-w-0 px-4 py-3 border shadow-sm transition-colors ${
          own
            ? "bg-primary/20 border-primary/25 rounded-2xl rounded-br-sm"
            : "bg-card border-border/70 rounded-2xl rounded-bl-sm"
        }`}
      >
        {children}
      </div>
      {zeit && (
        <div className="text-[11px] text-muted-foreground/60 mt-1.5 px-1 flex items-center gap-1.5">
          {wartet && <Loader2 className="w-3 h-3 animate-spin" />}
          {zeit}
        </div>
      )}
    </div>
  );
}

/*
 * Was Lukas gerade tut, statt drei hüpfender Punkte.
 *
 * Die Punkte sagen "es passiert etwas" — mehr nicht. Wenn er zwei Minuten
 * recherchiert, will man wissen, WAS gerade laeuft. Der Name des aktuellen
 * Werkzeugs steht deshalb dabei.
 */
function Denkt({ tool }: { tool: string | null }) {
  const text = tool ? TOOL_TEXT[tool] ?? "arbeitet" : "denkt nach";
  return (
    <div className="flex items-center gap-2.5 py-1" aria-live="polite">
      <span className="relative flex w-2.5 h-2.5 shrink-0">
        <span className="absolute inline-flex h-full w-full rounded-full bg-primary/50 animate-ping" />
        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-primary" />
      </span>
      <span className="text-sm bg-gradient-to-r from-muted-foreground via-foreground to-muted-foreground bg-[length:200%_100%] bg-clip-text text-transparent animate-[shimmer_2s_linear_infinite]">
        Lukas {text}…
      </span>
    </div>
  );
}

/** Werkzeugname → was das für Issa bedeutet, im Verlaufsform. */
const TOOL_TEXT: Record<string, string> = {
  execute_command: "führt einen Befehl aus",
  execute_on_host: "arbeitet auf dem Server",
  ask_subagent: "fragt sein Team",
  fetch_url: "liest eine Seite",
  web_search: "sucht im Netz",
  query_memory: "sucht in seinem Gedächtnis",
  remember: "merkt sich etwas",
  email_search: "durchsucht das Postfach",
  email_read: "liest eine Mail",
  email_send: "schreibt eine Mail",
  feel: "sortiert seine Gefühle",
};

export default function Chat() {
  const qc = useQueryClient();
  const [activeId, setActiveId] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState("");
  const [pending, setPending] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [optimisticMsg, setOptimisticMsg] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  /** Verbindung weg, Antwort noch unterwegs — wir laden nach statt zu klagen. */
  const [wartetAufNachzuegler, setWartetAufNachzuegler] = useState(false);
  /** Werkzeug, das gerade laeuft — fuer die Denkanzeige. */
  const [liveTool, setLiveTool] = useState<string | null>(null);
  /** Fertige Schritte dieses Zuges, damit man beim Zuschauen schon klicken kann. */
  const [liveSteps, setLiveSteps] = useState<ToolStep[]>([]);
  const [sentAttachments, setSentAttachments] = useState<Attachment[]>([]);
  const [atBottom, setAtBottom] = useState(true);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const { data: convos = [], isLoading: loadingConvos } = useListAnthropicConversations();
  const { data: activeConv } = useGetAnthropicConversation(activeId!, {
    query: {
      queryKey: getGetAnthropicConversationQueryKey(activeId!),
      enabled: activeId !== null,
    },
  });
  const createConvo = useCreateAnthropicConversation();
  const deleteConvo = useDeleteAnthropicConversation();

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (el) setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  }, []);

  useLayoutEffect(() => {
    if (atBottom) scrollToBottom("auto");
  }, [activeConv?.messages, optimisticMsg, streamContent, streaming, atBottom, scrollToBottom]);

  useLayoutEffect(() => {
    setAtBottom(true);
    scrollToBottom("auto");
  }, [activeId, scrollToBottom]);

  useEffect(() => {
    if (!activeId) return void setSentAttachments([]);
    const token = localStorage.getItem("lukas_token");
    fetch(`${BASE}/api/attachments/${activeId}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: Attachment[]) => setSentAttachments(rows))
      .catch(() => setSentAttachments([]));
  }, [activeId, activeConv?.messages?.length, streaming]);

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  useEffect(() => () => abortRef.current?.abort(), []);

  /*
   * Nach einem Verbindungsverlust auf die Antwort warten.
   *
   * Lukas arbeitet serverseitig weiter und legt sie ab. Alle 5 Sekunden
   * nachfragen, bis sie da ist — hoechstens zwei Minuten, damit es nicht
   * ewig weiterlaeuft, wenn wirklich etwas kaputt ist.
   */
  /*
   * Nachfragen, solange er arbeitet.
   *
   * Vorher stand hier eine feste Frist von zwei Minuten. Das war die Ursache
   * dafuer, dass er "oefter nicht antwortet": ein Zug, der ein Dutzend Dateien
   * liest, braucht laenger als zwei Minuten — dann stand da "Lad die Seite
   * neu", obwohl Lukas noch mitten in der Arbeit war und die Antwort kurz
   * darauf in der Datenbank landete.
   *
   * Jetzt sagt der Server selbst, ob der Zug noch laeuft (Feld `laeuft`).
   * Solange er arbeitet, geben wir nicht auf. Erst wenn er fertig meldet und
   * trotzdem keine Antwort kommt, laeuft eine kurze Frist ab — dann ist
   * wirklich etwas kaputt.
   */
  const convRef = useRef(activeConv);
  useEffect(() => {
    convRef.current = activeConv;
  }, [activeConv]);

  useEffect(() => {
    if (!wartetAufNachzuegler || !activeId) return;
    const NACHFRAGE_MS = 4000;
    let frist = Date.now() + GEDULD_MS;

    const t = setInterval(() => {
      // Jedes "ich arbeite noch" verlaengert die Geduld — siehe lib/geduld.ts.
      const schritt = warteSchritt(Date.now(), convRef.current?.laeuft ?? false, frist);
      frist = schritt.frist;

      if (schritt.aufgeben) {
        setWartetAufNachzuegler(false);
        setStreamError(
          "Die Verbindung war weg und er meldet auch keine laufende Arbeit mehr. " +
            "Lad die Seite neu — falls er doch fertig geworden ist, steht die Antwort dann da.",
        );
        return;
      }
      qc.invalidateQueries({ queryKey: getGetAnthropicConversationQueryKey(activeId) });
    }, NACHFRAGE_MS);
    return () => clearInterval(t);
  }, [wartetAufNachzuegler, activeId, qc]);

  /*
   * Zurueck im Tab — sofort nachsehen.
   *
   * Genau der Fall, in dem er "nicht geantwortet" hat: Handy legt den Tab
   * schlafen, die Leitung stirbt, und im Hintergrund drosselt der Browser auch
   * noch die Timer. Beim Zurueckkommen wartete die Oberflaeche bis zum
   * naechsten Intervall — oder hatte laengst aufgegeben. Ein Blick beim
   * Wiedersehen kostet eine Abfrage und spart das ganze Raetselraten.
   */
  useEffect(() => {
    if (!activeId) return;
    const nachsehen = () => {
      if (document.visibilityState !== "visible") return;
      qc.invalidateQueries({ queryKey: getGetAnthropicConversationQueryKey(activeId) });
    };
    document.addEventListener("visibilitychange", nachsehen);
    window.addEventListener("focus", nachsehen);
    return () => {
      document.removeEventListener("visibilitychange", nachsehen);
      window.removeEventListener("focus", nachsehen);
    };
  }, [activeId, qc]);

  /*
   * Nach einem Neuladen weiterwarten.
   *
   * Der Wartezustand lebte nur in React. Wurde der Tab verworfen oder die
   * Seite neu geladen, war er weg — und damit auch das Nachfragen, obwohl der
   * Server weiterarbeitete. Meldet er eine laufende Arbeit, nehmen wir das
   * Warten wieder auf.
   */
  useEffect(() => {
    if (streaming || wartetAufNachzuegler) return;
    if (activeConv?.laeuft) setWartetAufNachzuegler(true);
  }, [activeConv?.laeuft, streaming, wartetAufNachzuegler]);

  // Kommt eine neue Antwort an, ist das Warten vorbei.
  useEffect(() => {
    const letzte = activeConv?.messages?.[activeConv.messages.length - 1];
    if (wartetAufNachzuegler && letzte?.role === "assistant") setWartetAufNachzuegler(false);
  }, [activeConv?.messages, wartetAufNachzuegler]);

  const handleNew = async () => {
    const res = await createConvo.mutateAsync({ data: { title: `Chat ${new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}` } });
    setActiveId(res.id);
    qc.invalidateQueries({ queryKey: getListAnthropicConversationsQueryKey() });
  };

  const handleDelete = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    await deleteConvo.mutateAsync({ id });
    if (activeId === id) setActiveId(null);
    qc.invalidateQueries({ queryKey: getListAnthropicConversationsQueryKey() });
  };

  const authHeaders = (): Record<string, string> => {
    const token = localStorage.getItem("lukas_token");
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0 || !activeId) return;
    setUploading(true);
    setUploadError(null);
    try {
      const form = new FormData();
      Array.from(files).forEach((f) => form.append("files", f));
      const res = await fetch(`${BASE}/api/attachments/${activeId}`, { method: "POST", headers: authHeaders(), body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail || body?.error || `Upload fehlgeschlagen (${res.status})`);
      }
      const uploaded = (await res.json()) as Attachment[];
      setPending((prev) => [...prev, ...uploaded]);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload fehlgeschlagen");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removePending = async (id: number) => {
    setPending((prev) => prev.filter((a) => a.id !== id));
    await fetch(`${BASE}/api/attachments/file/${id}`, { method: "DELETE", headers: authHeaders() }).catch(() => {});
  };

  const handleCancel = useCallback(() => {
    /*
     * Erst dem Server sagen, DANN die Verbindung kappen.
     *
     * Ein geschlossener Socket allein ist kein Stopp — er sieht genauso aus
     * wie ein Funkloch. Nur dieser Aufruf beendet die Arbeit wirklich.
     */
    if (activeId) {
      const token = localStorage.getItem("lukas_token");
      fetch(`${BASE}/api/anthropic/conversations/${activeId}/stop`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      }).catch(() => {});
    }
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
    setStreamContent("");
    setOptimisticMsg(null);
    setLiveTool(null);
    setLiveSteps([]);
    if (activeId) qc.invalidateQueries({ queryKey: getGetAnthropicConversationQueryKey(activeId) });
  }, [activeId, qc]);

  const handleSend = useCallback(async () => {
    if ((!input.trim() && pending.length === 0) || !activeId || streaming) return;
    const msg = input.trim() || "(Datei angehängt)";
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;

    setInput("");
    setPending([]);
    setOptimisticMsg(msg);
    setStreaming(true);
    setStreamContent("");
    setStreamError(null);
    setWartetAufNachzuegler(false);
    setLiveTool(null);
    setLiveSteps([]);
    setAtBottom(true);

    try {
      const token = localStorage.getItem("lukas_token");
      const response = await fetch(`${BASE}/api/anthropic/conversations/${activeId}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ content: msg }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Chat fehlgeschlagen (${response.status})`);

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No stream");
      const decoder = new TextDecoder();

      // Warum gepuffert wird, steht in lib/sse.ts — es war der Grund für die
      // sporadisch ausbleibenden Antworten.
      let puffer = "";
      let done = false;
      /*
       * Kam das ABSCHLUSSSIGNAL des Servers?
       *
       * Das ist etwas anderes als "der Stream ist zu Ende". Ein Deploy, ein
       * Neustart oder ein abgestuerzter Prozess beenden die Leitung SAUBER —
       * kein Fehler, keine Ausnahme, die Schleife laeuft einfach aus. Vorher
       * passierte dann gar nichts: kein Text, keine Meldung, keine
       * Nachfrage. Die Frage stand da, und es sah aus, als habe Lukas sie
       * ignoriert.
       *
       * Genau das ist der Fall, den Issa als "er antwortet oft nicht" sieht —
       * und heute besonders oft, weil jeder Deploy laufende Zuege abschneidet.
       */
      let abschlussGesehen = false;
      while (!done && !controller.signal.aborted) {
        const { value, done: streamDone } = await reader.read();
        if (streamDone) done = true;
        if (value) puffer += decoder.decode(value, { stream: true });

        const { zeilen, rest } = takeCompleteLines(puffer);
        puffer = rest;

        for (const zeile of zeilen) {
          const parsed = parseSseData(zeile);
          if (!parsed) continue;
          if (parsed.content) setStreamContent((prev) => prev + String(parsed.content));
          // Werkzeuge stehen nicht mehr als "[⚙ name]" im Text — sie sind
          // eigene, anklickbare Schritte.
          if (parsed.tool) setLiveTool(String(parsed.tool));
          if (parsed.step) {
            setLiveSteps((prev) => [...prev, parsed.step as ToolStep]);
            setLiveTool(null);
          }
          // Ein Fehler gehört sichtbar in den Chat, nicht in die Konsole.
          if (parsed.error) setStreamError(String(parsed.error));
          if (parsed.done) {
            done = true;
            abschlussGesehen = true;
          }
        }
      }

      /*
       * Die Leitung ist zu Ende, aber der Server hat nie "fertig" gesagt.
       *
       * Dann arbeitet er womoeglich noch und speichert die Antwort gleich —
       * oder er ist mitten im Zug gestorben. Beides sieht von hier aus
       * identisch aus, und in beiden Faellen ist Nachfragen richtig: kommt die
       * Antwort, wird sie nachgeladen; kommt sie nicht, sagt die Geduldslogik
       * es nach ihrer Frist ehrlich. Nur stillschweigend nichts tun ist
       * falsch.
       */
      if (!abschlussGesehen && !controller.signal.aborted) {
        setStreamError(null);
        setWartetAufNachzuegler(true);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // Vom Stopp-Knopf — kein Fehler.
      } else {
        /*
         * Die Leitung ist weg — Funkloch, Bildschirm zu, Deploy. Der Server
         * arbeitet weiter und speichert die Antwort. Also NICHT als Fehler
         * anzeigen und die Arbeit für verloren erklären, sondern warten und
         * nachladen. Vorher stand hier "Load failed" und minutenlange Arbeit
         * sah aus wie verschwunden.
         */
        setStreamError(null);
        setWartetAufNachzuegler(true);
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setStreaming(false);
      setStreamContent("");
      setOptimisticMsg(null);
      setLiveTool(null);
      // Die Schritte haengen jetzt an der gespeicherten Nachricht — die lokale
      // Kopie darf weg, sonst stuenden sie doppelt da.
      setLiveSteps([]);
      qc.invalidateQueries({ queryKey: getGetAnthropicConversationQueryKey(activeId) });
    }
  }, [input, activeId, streaming, qc, pending.length]);

  /*
   * Die Frage von der Startseite uebernehmen.
   *
   * Dort steht das Eingabefeld, hier laeuft das Gespraech — die Frage wird
   * ueber sessionStorage gereicht und beim ersten Rendern eingesetzt. Der
   * Schluessel wird SOFORT geloescht: sonst taucht dieselbe Frage bei jedem
   * Zurueckblaettern erneut auf.
   *
   * Abgeschickt wird nicht automatisch. Sie steht im Feld, der Cursor
   * dahinter — wer sich vertippt hat, kann es hier noch sehen. Ein Zug, der
   * ohne Zutun losgeht, ist bei einem Agenten mit Werkzeugen die falsche
   * Voreinstellung.
   */
  useEffect(() => {
    const frage = sessionStorage.getItem("lukas_startfrage");
    if (!frage) return;
    sessionStorage.removeItem("lukas_startfrage");
    setInput(frage);
    textareaRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const autoVoice = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("voice") === "auto";
  const allMessages = activeConv?.messages ?? [];
  const isMobile = useIsMobile();
  const showList = !isMobile || activeId === null;
  const showChat = !isMobile || activeId !== null;

  return (
    <div className="flex flex-col h-full min-w-0">
      <VoicePanel autoStart={autoVoice} />
      <div className="flex flex-1 min-h-0 min-w-0">
        {showList && (
          <div className="w-full md:w-72 border-r border-border flex flex-col shrink-0">
            <div className="p-3">
              <Button onClick={handleNew} variant="outline" className="w-full justify-start gap-2 h-10" disabled={createConvo.isPending}>
                <Plus className="w-4 h-4" /> Neuer Chat
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5">
              {loadingConvos && <div className="text-sm text-muted-foreground px-3 py-2">Lädt…</div>}
              {convos.map((c) => (
                <div key={c.id} onClick={() => setActiveId(c.id)} className={`group flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${activeId === c.id ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"}`}>
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-sm">{c.title}</div>
                    <div className="text-xs text-muted-foreground/70 mt-0.5">{relativeDay(c.createdAt)}</div>
                  </div>
                  <button onClick={(e) => handleDelete(c.id, e)} className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity text-muted-foreground hover:text-destructive p-1 -m-1" aria-label={`${c.title} löschen`}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {!loadingConvos && convos.length === 0 && <p className="text-sm text-muted-foreground px-3 py-2">Noch keine Gespräche.</p>}
            </div>
          </div>
        )}

        {showChat && (
          <div className="flex-1 flex flex-col min-w-0 relative">
            {activeId ? (
              <>
                <div className="h-14 border-b border-border px-4 flex items-center gap-3 shrink-0">
                  {isMobile && (
                    <button onClick={() => setActiveId(null)} className="text-muted-foreground hover:text-foreground shrink-0" aria-label="Zurück zur Liste" data-testid="button-back-to-list">
                      <ArrowLeft className="w-5 h-5" />
                    </button>
                  )}
                  <span className="truncate font-medium">{activeConv?.title ?? "…"}</span>
                </div>

                <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto overflow-x-hidden">
                  <div className="max-w-3xl mx-auto px-4 py-6 space-y-6 sm:px-6">
                    {allMessages.map((m) => {
                      const own = m.role === "user";
                      const files = sentAttachments.filter((a) => a.messageId === m.id);
                      const steps = (m as { steps?: ToolStep[] | null }).steps ?? [];
                      return (
                        <Bubble key={m.id} own={own} zeit={chatTime(m.createdAt)}>
                          <div className="text-[15px] leading-7 whitespace-pre-wrap break-words">
                            {renderWithLinks(m.content)}
                          </div>
                          {files.length > 0 && (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {files.map((a) => {
                                const Icon = attachmentIcon(a.kind);
                                return a.kind === "image" ? (
                                  <a key={a.id} href={`${BASE}${a.url}`} target="_blank" rel="noreferrer">
                                    <img
                                      src={`${BASE}${a.url}`}
                                      alt={a.filename}
                                      className="max-h-52 rounded-xl border border-border transition-transform duration-200 hover:scale-[1.02]"
                                    />
                                  </a>
                                ) : (
                                  <a
                                    key={a.id}
                                    href={`${BASE}${a.url}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="flex items-center gap-2 rounded-xl border border-border bg-card/80 px-3 py-2 text-sm hover:border-primary/40 transition-colors"
                                  >
                                    <Icon className="w-4 h-4 text-primary shrink-0" />
                                    <span className="truncate max-w-[180px]">{a.filename}</span>
                                    <span className="text-muted-foreground text-xs">{formatSize(a.sizeBytes)}</span>
                                  </a>
                                );
                              })}
                            </div>
                          )}
                          {!own && steps.length > 0 && <ToolSteps steps={steps} />}
                        </Bubble>
                      );
                    })}

                    {optimisticMsg && (
                      <Bubble own zeit="senden…" wartet>
                        <div className="text-[15px] leading-7 whitespace-pre-wrap break-words">
                          {renderWithLinks(optimisticMsg)}
                        </div>
                      </Bubble>
                    )}

                    {streaming && (
                      <Bubble own={false}>
                        {streamContent ? (
                          <div className="text-[15px] leading-7 whitespace-pre-wrap break-words">
                            {streamContent}
                            <span className="inline-block w-[3px] h-[1.1em] align-[-0.15em] ml-0.5 bg-primary animate-pulse rounded-full" />
                          </div>
                        ) : (
                          <Denkt tool={liveTool} />
                        )}
                        {liveSteps.length > 0 && <ToolSteps steps={liveSteps} />}
                      </Bubble>
                    )}

                    {wartetAufNachzuegler && (
                      <div className="flex min-w-0 animate-in fade-in slide-in-from-left-3 duration-300">
                        <div className="min-w-0 max-w-[85%] rounded-2xl rounded-bl-sm border border-amber-400/30 bg-amber-400/10 px-4 py-3">
                          <div className="text-sm font-medium text-amber-300 mb-1 flex items-center gap-2">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Verbindung war weg
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Lukas arbeitet weiter — seine Antwort wird gespeichert und erscheint
                            hier, sobald sie fertig ist.
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Ein Fehler bleibt stehen, bis die naechste Nachricht raus geht. */}
                    {streamError && !streaming && (
                      <div className="flex min-w-0 animate-in fade-in slide-in-from-left-3 duration-300">
                        <div className="min-w-0 max-w-[85%] rounded-2xl rounded-bl-sm border border-destructive/30 bg-destructive/10 px-4 py-3">
                          <div className="text-sm font-medium text-destructive mb-1">
                            Die Antwort ist nicht angekommen
                          </div>
                          <div className="text-xs text-muted-foreground break-words">{streamError}</div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {!atBottom && (
                  <button onClick={() => { setAtBottom(true); scrollToBottom(); }} className="absolute bottom-32 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs shadow-lg hover:border-primary/40 transition-colors">
                    <ArrowDown className="w-3.5 h-3.5" /> Neueste
                  </button>
                )}

                <div className="px-4 pb-4 pt-2 sm:px-6 shrink-0" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}>
                  <div className="max-w-3xl mx-auto">
                    {(pending.length > 0 || uploading || uploadError) && (
                      <div className="mb-2 flex flex-wrap gap-2">
                        {pending.map((a) => {
                          const Icon = attachmentIcon(a.kind);
                          return (
                            <div key={a.id} className="flex items-center gap-2 bg-card border border-border rounded-xl pl-2 pr-1 py-1.5 max-w-[240px]">
                              {a.kind === "image" ? <img src={`${BASE}${a.url}`} alt={a.filename} className="w-8 h-8 rounded-lg object-cover shrink-0" /> : <Icon className="w-4 h-4 text-primary shrink-0" />}
                              <div className="min-w-0"><div className="text-xs truncate">{a.filename}</div><div className="text-[10px] text-muted-foreground">{formatSize(a.sizeBytes)}</div></div>
                              <button onClick={() => removePending(a.id)} className="text-muted-foreground hover:text-destructive shrink-0 p-1" aria-label={`${a.filename} entfernen`}><X className="w-3.5 h-3.5" /></button>
                            </div>
                          );
                        })}
                        {uploading && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="w-3.5 h-3.5 animate-spin" /> lädt hoch…</div>}
                        {uploadError && <div className="text-xs text-destructive">{uploadError}</div>}
                      </div>
                    )}

                    <div className="flex items-end gap-2 rounded-2xl border border-border bg-card px-2 py-2 focus-within:border-primary/40 transition-colors">
                      <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} />
                      <button onClick={() => fileInputRef.current?.click()} disabled={streaming || uploading} className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-40 shrink-0" aria-label="Datei anhängen" data-testid="button-attach">
                        <Paperclip className="w-5 h-5" />
                      </button>
                      <textarea ref={textareaRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown} placeholder="Schreibe Lukas…" rows={1} disabled={streaming} className="flex-1 bg-transparent resize-none py-2 text-[15px] leading-6 outline-none placeholder:text-muted-foreground/60 disabled:opacity-50 max-h-[200px]" />
                      {streaming ? (
                        <button onClick={handleCancel} className="p-2 rounded-lg bg-primary text-primary-foreground transition-colors shrink-0 hover:opacity-90" aria-label="Antwort stoppen" data-testid="button-stop-response">
                          <Square className="w-5 h-5 fill-current" />
                        </button>
                      ) : (
                        <button onClick={handleSend} disabled={(!input.trim() && pending.length === 0)} className="p-2 rounded-lg bg-primary text-primary-foreground disabled:opacity-30 disabled:bg-secondary disabled:text-muted-foreground transition-colors shrink-0" aria-label="Senden">
                          <ArrowUp className="w-5 h-5" />
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground/60 mt-2 text-center hidden sm:block">Enter zum Senden · Shift+Enter für eine neue Zeile</p>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
                <MessageSquare className="w-12 h-12 text-muted-foreground/25 mb-5" />
                <h2 className="text-lg font-semibold mb-1.5">Womit fangen wir an?</h2>
                <p className="text-muted-foreground text-sm mb-6 max-w-sm">Starte ein neues Gespräch — Lukas erinnert sich an alles, was ihr besprecht.</p>
                <Button onClick={handleNew} className="gap-2" disabled={createConvo.isPending}><Plus className="w-4 h-4" /> Neuer Chat</Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
