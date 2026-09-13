import { useState } from "react";
import {
  useGetLukasStatus,
  useGetMemories,
  useCreateMemory,
  useDeleteMemory,
  getGetMemoriesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Search, Brain, Star } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { de } from "date-fns/locale";
import { Seite, Karte, Chip, Leer, Laedt, staffel } from "@/components/seite";
import { kategorie } from "@/lib/worte";

const CATEGORIES = ["personal", "preference", "goal", "project", "finance", "gaming", "health", "learning", "trading", "work", "other"];

/* Die Kategorie faerbt die Pille — sonst sind hundert Erinnerungen eine Wand. */
const TON: Record<string, "gut" | "warnung" | "schlecht" | "info" | "akzent" | "neutral"> = {
  personal: "info",
  preference: "akzent",
  goal: "gut",
  project: "warnung",
  finance: "warnung",
  gaming: "schlecht",
  health: "gut",
  learning: "info",
  trading: "gut",
  work: "akzent",
};

export default function Memory() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("kuratiert");
  const [open, setOpen] = useState(false);
  const [newContent, setNewContent] = useState("");
  const [newCat, setNewCat] = useState("personal");
  const [newImportance, setNewImportance] = useState("5");
  const [newTags, setNewTags] = useState("");

  /*
   * Standardmaessig OHNE Chatverlauf.
   *
   * Jede Nachricht wird als niedrig gewichtete "conversation"-Erinnerung
   * abgelegt, damit Lukas alte Formulierungen wiederfindet. Fuer die Suche ist
   * das richtig — fuer diese Uebersicht nicht: sonst bestehen die 100
   * geladenen Eintraege fast nur aus Gespraechsschnipseln, und die kuratierten
   * Fakten sind zwischen ihnen nicht mehr zu finden.
   */
  const { data: memories = [], isLoading } = useGetMemories({
    search: search || undefined,
    category: category !== "all" && category !== "kuratiert" ? category : undefined,
    exclude: category === "kuratiert" ? "conversation" : undefined,
    limit: 100,
  });

  // Echter Bestand (COUNT(*)) — die Liste selbst ist auf 100 gedeckelt.
  const { data: uebersicht } = useGetLukasStatus();
  const gesamt = uebersicht?.memoriesCount;

  const createMemory = useCreateMemory();
  const deleteMemory = useDeleteMemory();

  const handleCreate = async () => {
    if (!newContent.trim()) return;
    await createMemory.mutateAsync({
      data: {
        content: newContent,
        category: newCat,
        importance: parseInt(newImportance),
        tags: newTags.split(",").map((t) => t.trim()).filter(Boolean),
      },
    });
    qc.invalidateQueries({ queryKey: getGetMemoriesQueryKey() });
    setOpen(false);
    setNewContent("");
    setNewTags("");
  };

  const handleDelete = async (id: number) => {
    await deleteMemory.mutateAsync({ id });
    qc.invalidateQueries({ queryKey: getGetMemoriesQueryKey() });
  };

  return (
    <Seite
      icon={Brain}
      titel="Gedächtnis"
      breit
      /*
       * memories.length war die SEITENGROESSE, nicht der Bestand: die Liste
       * wird mit limit 100 geholt, also stand dort bei jedem groesseren
       * Gedaechtnis exakt "100 Erinnerungen gespeichert". Der echte Wert kommt
       * als COUNT(*) aus dem Status-Endpunkt.
       */
      unterzeile={
        gesamt !== undefined
          ? `${memories.length} von ${gesamt} geladen`
          : `${memories.length} geladen`
      }
      aktionen={
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2 rounded-full">
              <Plus className="h-4 w-4" /> Neue Erinnerung
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Erinnerung speichern</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <Textarea
                placeholder="Was soll Lukas wissen?"
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                className="min-h-[100px] text-sm"
              />
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">Kategorie</label>
                  <Select value={newCat} onValueChange={setNewCat}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((c) => (
                        <SelectItem key={c} value={c}>{kategorie(c)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">Wichtigkeit (1–10)</label>
                  <Input type="number" min="1" max="10" value={newImportance} onChange={(e) => setNewImportance(e.target.value)} />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">Schlagworte (kommagetrennt)</label>
                <Input placeholder="ki, projekt, wichtig" value={newTags} onChange={(e) => setNewTags(e.target.value)} className="text-sm" />
              </div>
              <Button onClick={handleCreate} className="w-full rounded-full" disabled={!newContent.trim() || createMemory.isPending}>
                Speichern
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      }
      unterKopf={
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Erinnerungen durchsuchen…"
              aria-label="Erinnerungen durchsuchen"
              className="h-11 w-full rounded-full bg-white/[0.05] pl-11 pr-4 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:bg-white/[0.08]"
            />
          </div>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="h-11 w-full rounded-full border-0 bg-white/[0.05] px-5 text-sm sm:w-52">
              <SelectValue placeholder="Kategorie" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="kuratiert">Ohne Chatverlauf</SelectItem>
              <SelectItem value="all">Alle</SelectItem>
              {CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>{kategorie(c)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      }
    >
      {isLoading && <Laedt was="Erinnerungen werden geladen…" />}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {memories.map((m, idx) => (
          <Karte key={m.id} verzoegerung={staffel(idx)} className="group">
            <div className="flex items-start justify-between gap-3">
              {/*
               * min-w-0 ist hier nicht kosmetisch: ein Flex-Kind schrumpft
               * sonst nicht unter seine Inhaltsbreite, und ein einzelner
               * langer Block ohne Leerzeichen — ein SHA-256-Hash etwa —
               * sprengt damit die ganze Karte nach rechts aus dem Bild.
               */}
              <p className="min-w-0 flex-1 text-[15px] leading-relaxed break-words whitespace-pre-wrap">
                {m.content}
              </p>
              <button
                onClick={() => handleDelete(m.id)}
                aria-label="Erinnerung löschen"
                /*
                 * Auf dem Handy gibt es kein Hover. Mit opacity-0 war der
                 * Knopf dort schlicht nie erreichbar — versteckt erst ab sm,
                 * wo es einen Zeiger gibt.
                 */
                className="mt-0.5 shrink-0 rounded-full p-1.5 text-muted-foreground transition-all hover:text-destructive sm:opacity-0 sm:group-hover:opacity-100"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {/*
                Nur wenn es eine gibt. Ohne diese Pruefung stand dort bei
                einer Erinnerung ohne Kategorie eine leere graue Pille mit
                einem Gedankenstrich — im Bild sah das aus wie ein Fehler,
                und genau so ist es beim Nachsehen aufgefallen.
              */}
              {m.category && <Chip ton={TON[m.category] ?? "neutral"}>{kategorie(m.category)}</Chip>}
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Star className="h-3 w-3" />
                {m.importance}/10
              </span>
              {m.tags?.map((tag) => (
                <Chip key={tag}>#{tag}</Chip>
              ))}
              <span className="ml-auto text-[11px] text-muted-foreground">
                {formatDistanceToNow(new Date(m.createdAt), { addSuffix: true, locale: de })}
              </span>
            </div>
          </Karte>
        ))}
      </div>

      {!isLoading && memories.length === 0 && (
        <Leer
          icon={Brain}
          titel={search ? "Nichts gefunden" : "Noch keine Erinnerungen"}
          hinweis={
            search
              ? `Zu „${search}“ liegt nichts vor. Ohne Filter siehst du mehr.`
              : "Was Lukas über dich weiß, sammelt sich hier — aus euren Gesprächen oder von Hand eingetragen."
          }
        />
      )}
    </Seite>
  );
}
