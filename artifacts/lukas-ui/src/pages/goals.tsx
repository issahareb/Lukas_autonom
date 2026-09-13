import { useState } from "react";
import {
  useGetGoals,
  useCreateGoal,
  useUpdateGoal,
  useDeleteGoal,
  getGetGoalsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, CheckCircle2, Target, Clock, AlertCircle, RotateCcw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { de } from "date-fns/locale";
import { Seite, Karte, Chip, Leer, Laedt, staffel } from "@/components/seite";
import { prioritaet, zielstand } from "@/lib/worte";

const PRIO_TON = { high: "schlecht", medium: "warnung", low: "gut" } as const;

const STAND_SYMBOL: Record<string, React.ReactNode> = {
  active: <Clock className="h-4 w-4 text-sky-300" />,
  completed: <CheckCircle2 className="h-4 w-4 text-emerald-300" />,
  failed: <AlertCircle className="h-4 w-4 text-red-300" />,
};

const FILTER = ["all", "active", "completed", "failed"];

export default function Goals() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("high");
  const [filter, setFilter] = useState("all");

  const { data: goals = [], isLoading } = useGetGoals();
  const createGoal = useCreateGoal();
  const updateGoal = useUpdateGoal();
  const deleteGoal = useDeleteGoal();

  const filtered = filter === "all" ? goals : goals.filter((g) => g.status === filter);

  const handleCreate = async () => {
    if (!title.trim() || !description.trim()) return;
    await createGoal.mutateAsync({ data: { title, description, priority } });
    qc.invalidateQueries({ queryKey: getGetGoalsQueryKey() });
    setOpen(false);
    setTitle("");
    setDescription("");
  };

  const handleStatusChange = async (id: number, status: string) => {
    await updateGoal.mutateAsync({ id, data: { status } });
    qc.invalidateQueries({ queryKey: getGetGoalsQueryKey() });
  };

  const handleDelete = async (id: number) => {
    await deleteGoal.mutateAsync({ id });
    qc.invalidateQueries({ queryKey: getGetGoalsQueryKey() });
  };

  const aktiv = goals.filter((g) => g.status === "active").length;
  const erledigt = goals.filter((g) => g.status === "completed").length;

  return (
    <Seite
      icon={Target}
      titel="Ziele"
      unterzeile={`${aktiv} aktiv, ${erledigt} erledigt`}
      aktionen={
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2 rounded-full">
              <Plus className="h-4 w-4" /> Neues Ziel
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Ziel anlegen</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <Input placeholder="Worum geht es?" value={title} onChange={(e) => setTitle(e.target.value)} />
              <Textarea
                placeholder="Was genau ist das Ziel? Warum ist es wichtig?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="min-h-[100px] text-sm"
              />
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">Wie wichtig?</label>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="high">Wichtig</SelectItem>
                    <SelectItem value="medium">Mittel</SelectItem>
                    <SelectItem value="low">Nebenbei</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={handleCreate}
                className="w-full rounded-full"
                disabled={!title.trim() || !description.trim() || createGoal.isPending}
              >
                Ziel setzen
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      }
      unterKopf={
        /*
         * Vorher standen hier vier umrandete Kaesten mit ALL / ACTIVE /
         * COMPLETED / FAILED — englische Datenbankwerte in Grossbuchstaben.
         * Jetzt Pillen in Satzschrift, und der gewaehlte ist gefuellt statt
         * umrandet.
         */
        <div className="flex flex-wrap gap-2">
          {FILTER.map((s) => {
            const gewaehlt = filter === s;
            const anzahl = s === "all" ? goals.length : goals.filter((g) => g.status === s).length;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setFilter(s)}
                aria-pressed={gewaehlt}
                className={`rounded-full px-4 py-1.5 text-sm transition-colors ${
                  gewaehlt
                    ? "bg-primary text-primary-foreground"
                    : "bg-white/[0.06] text-muted-foreground hover:bg-white/[0.1] hover:text-foreground"
                }`}
              >
                {zielstand(s)}
                <span className="ml-1.5 opacity-60">{anzahl}</span>
              </button>
            );
          })}
        </div>
      }
    >
      {isLoading && <Laedt was="Ziele werden geladen…" />}

      <div className="space-y-4">
        {filtered.map((g, idx) => (
          <Karte key={g.id} verzoegerung={staffel(idx)} className="group">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 shrink-0">{STAND_SYMBOL[g.status] ?? <Clock className="h-4 w-4" />}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-[1.05rem] font-semibold leading-snug tracking-tight break-words">
                    {g.title}
                  </h2>
                  <Chip ton={PRIO_TON[g.priority as keyof typeof PRIO_TON] ?? "neutral"}>
                    {prioritaet(g.priority)}
                  </Chip>
                </div>
                <p className="mt-1.5 text-sm leading-relaxed break-words text-muted-foreground">
                  {g.description}
                </p>

                {g.progress && (
                  <div className="mt-3 rounded-2xl bg-white/[0.04] px-4 py-3">
                    <p className="text-[11px] text-muted-foreground">Wie weit er ist</p>
                    <p className="mt-1 text-sm leading-relaxed break-words">{g.progress}</p>
                  </div>
                )}

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {g.status === "active" ? (
                    <>
                      <button
                        type="button"
                        onClick={() => handleStatusChange(g.id, "completed")}
                        className="flex items-center gap-1.5 rounded-full bg-emerald-400/10 px-3.5 py-1.5 text-xs text-emerald-300 transition-colors hover:bg-emerald-400/20"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" /> Erledigt
                      </button>
                      <button
                        type="button"
                        onClick={() => handleStatusChange(g.id, "failed")}
                        className="flex items-center gap-1.5 rounded-full bg-destructive/12 px-3.5 py-1.5 text-xs text-red-300 transition-colors hover:bg-destructive/20"
                      >
                        <AlertCircle className="h-3.5 w-3.5" /> Gescheitert
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleStatusChange(g.id, "active")}
                      className="flex items-center gap-1.5 rounded-full bg-white/[0.06] px-3.5 py-1.5 text-xs transition-colors hover:bg-white/[0.1]"
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> Wieder aufnehmen
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleDelete(g.id)}
                    aria-label={`Ziel „${g.title}“ löschen`}
                    /*
                     * Auf dem Handy gibt es kein Hover — mit opacity-0 waere
                     * der Knopf dort nie erreichbar. Sichtbar, und erst ab sm
                     * versteckt er sich bis zum Zeigen.
                     */
                    className="rounded-full p-1.5 text-muted-foreground transition-all hover:text-destructive sm:opacity-0 sm:group-hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    {formatDistanceToNow(new Date(g.createdAt), { addSuffix: true, locale: de })}
                  </span>
                </div>
              </div>
            </div>
          </Karte>
        ))}
      </div>

      {!isLoading && filtered.length === 0 && (
        <Leer
          icon={Target}
          titel={filter === "all" ? "Noch keine Ziele" : `Nichts unter „${zielstand(filter)}“`}
          hinweis={
            filter === "all"
              ? "Ein Ziel sagt Lukas, woran er zwischen euren Gesprächen arbeiten soll."
              : undefined
          }
        />
      )}
    </Seite>
  );
}
