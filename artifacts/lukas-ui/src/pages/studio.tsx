import { useState, useEffect, useCallback } from "react";
import {
  useGenerateHiggsfieldPrompt,
  useGenerateMedia,
  useGetMediaJobs,
  useGetMediaStatus,
  getGetMediaStatusQueryKey,
  getGetMediaJobsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Film,
  Image,
  Sparkles,
  Send,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Clock,
  ExternalLink,
  ChevronRight,
  Wand2,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { de } from "date-fns/locale";
import { PageHeader } from "@/components/page-header";

type MediaType = "image" | "video";
type Step = "vision" | "prompt" | "generating" | "done";
type KatalogModell = { id: string; wofuer: string };

interface GeneratedPromptData {
  prompt: string;
  negativePrompt?: string | null;
  suggestedModel: string;
  aspectRatio?: string | null;
  duration?: number | null;
  reasoning: string;
}

function JobStatusBadge({ status }: { status: string }) {
  const configs: Record<string, { color: string; icon: React.ReactNode }> = {
    pending: { color: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20", icon: <Clock className="w-3 h-3" /> },
    processing: { color: "bg-blue-500/10 text-blue-400 border-blue-500/20", icon: <Loader2 className="w-3 h-3 animate-spin" /> },
    completed: { color: "bg-green-500/10 text-green-400 border-green-500/20", icon: <CheckCircle2 className="w-3 h-3" /> },
    failed: { color: "bg-red-500/10 text-red-400 border-red-500/20", icon: <AlertCircle className="w-3 h-3" /> },
  };
  const cfg = configs[status] ?? configs.pending;
  // Kein GESCHREI in Grossbuchstaben — der Zustand auf Deutsch reicht.
  const text: Record<string, string> = {
    pending: "wartet",
    processing: "läuft",
    completed: "fertig",
    failed: "fehlgeschlagen",
  };
  return (
    <span className={`text-xs px-2.5 py-0.5 rounded-full border flex items-center gap-1.5 ${cfg.color}`}>
      {cfg.icon} {text[status] ?? status}
    </span>
  );
}

function JobCard({ job }: { job: { id: number; requestId?: string | null; status: string; prompt: string; vision?: string | null; mediaType: string; resultUrl?: string | null; createdAt: string } }) {
  const qc = useQueryClient();
  const { data: statusData } = useGetMediaStatus(job.requestId!, {
    query: {
      queryKey: getGetMediaStatusQueryKey(job.requestId!),
      enabled: !!job.requestId && (job.status === "processing" || job.status === "pending"),
      refetchInterval: job.status === "processing" ? 3000 : false,
    },
  });

  useEffect(() => {
    if (statusData?.status === "completed" || statusData?.status === "failed") {
      qc.invalidateQueries({ queryKey: getGetMediaJobsQueryKey() });
    }
  }, [statusData?.status, qc]);

  const displayStatus = statusData?.status ?? job.status;
  const resultUrl = statusData?.resultUrl ?? job.resultUrl;

  return (
    <div className="bg-card card-soft rounded-3xl p-4 hover:border-primary/20 transition-colors">
      {resultUrl && displayStatus === "completed" && (
        <div className="mb-3 rounded-md overflow-hidden bg-black aspect-video relative">
          {job.mediaType === "image" ? (
            <img src={resultUrl} alt="Generated" className="w-full h-full object-contain" />
          ) : (
            <video src={resultUrl} controls className="w-full h-full" />
          )}
        </div>
      )}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium leading-snug line-clamp-2">
            {job.vision ?? job.prompt}
          </div>
          <div className="text-xs text-muted-foreground mt-1 line-clamp-1">{job.prompt}</div>
        </div>
        <JobStatusBadge status={displayStatus} />
      </div>
      {/* Fehlgeschlagene Jobs zeigen jetzt den echten Grund statt nur "FAILED" */}
      {displayStatus === "failed" && (job as { error?: string | null }).error && (
        <div className="mt-3 text-xs bg-red-500/10 border border-red-500/20 text-red-300 rounded-md px-3 py-2 break-words">
          {(job as { error?: string | null }).error}
        </div>
      )}
      <div className="flex items-center gap-3 mt-3 pt-3 border-t border-border/50">
        <span className={`text-xs flex items-center gap-1 ${job.mediaType === "video" ? "text-purple-400" : "text-blue-400"}`}>
          {job.mediaType === "video" ? <Film className="w-3 h-3" /> : <Image className="w-3 h-3" />}
          {job.mediaType === "video" ? "Video" : "Bild"}
        </span>
        <span className="text-xs text-muted-foreground ml-auto">
          {formatDistanceToNow(new Date(job.createdAt), { addSuffix: true, locale: de })}
        </span>
        {resultUrl && (
          <a href={resultUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1">
            Öffnen <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
    </div>
  );
}

export default function Studio() {
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>("vision");
  const [mediaType, setMediaType] = useState<MediaType>("image");
  const [vision, setVision] = useState("");
  const [style, setStyle] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [generatedPrompt, setGeneratedPrompt] = useState<GeneratedPromptData | null>(null);
  const [editedPrompt, setEditedPrompt] = useState("");

  /*
   * Modell, Format und Dauer sind Vorschlaege von Lukas — und Vorschlaege muss
   * man aendern koennen. Vorher standen die drei Werte als nackter Text da:
   * kein Feld, kein Klick, nichts. Bei einem Bild stand dort sogar eine Dauer,
   * die es gar nicht gibt.
   */
  const [chosenModel, setChosenModel] = useState("");
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [durationSec, setDurationSec] = useState(5);

  /*
   * Der Modellkatalog kommt vom Server. Er hier noch einmal einzutippen waere
   * eine zweite Liste, die beim naechsten neuen Modell veraltet — und genau so
   * ist das Studio vorher auf drei Namen stehengeblieben, die es im MCP-Katalog
   * gar nicht gibt.
   */
  const [katalog, setKatalog] = useState<Record<MediaType, KatalogModell[]>>({
    image: [],
    video: [],
  });
  useEffect(() => {
    const token = localStorage.getItem("lukas_token");
    fetch(`${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/higgsfield/models`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => data && setKatalog(data))
      .catch(() => {});
  }, []);

  // Solange der Katalog nicht da ist, steht wenigstens Lukas' Wahl zur Auswahl.
  const modelle =
    katalog[mediaType].length > 0
      ? katalog[mediaType]
      : chosenModel
        ? [{ id: chosenModel, wofuer: "Vorschlag von Lukas" }]
        : [];

  const { data: jobs = [] } = useGetMediaJobs();
  const generatePrompt = useGenerateHiggsfieldPrompt();
  const generateMedia = useGenerateMedia();

  const handleGeneratePrompt = async () => {
    if (!vision.trim()) return;
    const result = await generatePrompt.mutateAsync({
      data: {
        vision,
        mediaType,
        style: style || undefined,
        imageUrl: imageUrl || undefined,
      },
    });
    setGeneratedPrompt(result);
    setEditedPrompt(result.prompt);
    setChosenModel(result.suggestedModel);
    setAspectRatio(result.aspectRatio ?? "16:9");
    setDurationSec(result.duration ?? 5);
    setStep("prompt");
  };

  const handleGenerate = async () => {
    if (!editedPrompt.trim() || !generatedPrompt) return;
    setStep("generating");
    try {
      await generateMedia.mutateAsync({
        data: {
          model: chosenModel || generatedPrompt.suggestedModel,
          prompt: editedPrompt,
          imageUrl: imageUrl || undefined,
          aspectRatio,
          // Ein Bild hat keine Dauer — das Feld bleibt dann weg.
          duration: mediaType === "video" ? durationSec : undefined,
          vision,
        },
      });
      qc.invalidateQueries({ queryKey: getGetMediaJobsQueryKey() });
      setStep("done");
    } catch {
      setStep("prompt");
    }
  };

  const handleReset = () => {
    setStep("vision");
    setVision("");
    setStyle("");
    setImageUrl("");
    setGeneratedPrompt(null);
    setEditedPrompt("");
  };

  return (
    // Auf Mobil untereinander (die Render-Queue wandert unter das Studio), erst
    // ab lg nebeneinander mit fester Hoehe. Vorher war die rechte Spalte hart
    // w-80 ohne Fallback — auf Handybreite blieb fuer die linke Spalte fast
    // nichts uebrig und die Inhalte schoben sich ineinander.
    <div className="flex flex-col lg:flex-row lg:h-full">
      {/* Left: Studio */}
      <div className="flex min-w-0 flex-1 flex-col border-b border-white/[0.05] lg:border-b-0 lg:border-r">
        <PageHeader
          icon={Wand2}
          title="Studio"
          subtitle="Vision eingeben → KI erstellt perfekten Prompt → Higgsfield generiert"
        >
          {/* Steps indicator */}
          <div className="flex items-center gap-2 flex-wrap">
            {(["vision", "prompt", "generating", "done"] as Step[]).map((s, i) => (
              <div key={s} className="flex items-center gap-2">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                  step === s ? "bg-primary text-primary-foreground" :
                  ["vision", "prompt", "generating", "done"].indexOf(step) > i ? "bg-primary/30 text-primary" : "bg-secondary text-muted-foreground"
                }`}>{i + 1}</div>
                <span className="text-xs text-muted-foreground hidden sm:block">
                  {s === "vision" ? "Vision" : s === "prompt" ? "Prompt" : s === "generating" ? "Rendern" : "Fertig"}
                </span>
                {i < 3 && <ChevronRight className="w-3 h-3 text-muted-foreground" />}
              </div>
            ))}
          </div>
        </PageHeader>

        <ScrollArea className="lg:flex-1">
          <div className="p-5 sm:p-6 space-y-6 max-w-2xl">
            {/* Step 1: Vision */}
            {step === "vision" && (
              <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-300">
                <div className="flex gap-3">
                  <Button
                    variant={mediaType === "image" ? "default" : "outline"}
                    onClick={() => setMediaType("image")}
                    className="flex-1 gap-2"
                  >
                    <Image className="w-4 h-4" /> Bild
                  </Button>
                  <Button
                    variant={mediaType === "video" ? "default" : "outline"}
                    onClick={() => setMediaType("video")}
                    className="flex-1 gap-2"
                  >
                    <Film className="w-4 h-4" /> Video
                  </Button>
                </div>

                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">Deine Vision</label>
                  <Textarea
                    placeholder={mediaType === "image"
                      ? "z.B. Eine Frau in einem nebligen japanischen Wald bei Sonnenaufgang, cinematisch..."
                      : "z.B. Ein Sportwagen rast durch eine neonbeleuchtete Stadt, Kamera folgt von hinten..."
                    }
                    value={vision}
                    onChange={(e) => setVision(e.target.value)}
                    className="min-h-[120px] text-sm resize-none"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">Stil (optional)</label>
                  <Input
                    placeholder="cinematisch, anime, watercolor, hyperrealistic, dark..."
                    value={style}
                    onChange={(e) => setStyle(e.target.value)}
                    className="text-sm"
                  />
                </div>

                {mediaType === "video" && (
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">Referenzbild-URL (optional, als Ausgangsbild)</label>
                    <Input
                      placeholder="https://example.com/bild.jpg"
                      value={imageUrl}
                      onChange={(e) => setImageUrl(e.target.value)}
                      className="text-sm"
                    />
                  </div>
                )}

                <Button
                  onClick={handleGeneratePrompt}
                  disabled={!vision.trim() || generatePrompt.isPending}
                  className="w-full gap-2 h-12"
                >
                  {generatePrompt.isPending ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Lukas denkt nach…</>
                  ) : (
                    <><Sparkles className="w-4 h-4" /> Prompt erstellen</>
                  )}
                </Button>
              </div>
            )}

            {/* Step 2: Prompt review */}
            {step === "prompt" && generatedPrompt && (
              <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-300">
                <div className="bg-primary/5 border border-primary/20 rounded-lg p-4">
                  <div className="text-xs text-primary mb-2">LUKAS' BEGRÜNDUNG:</div>
                  <p className="text-sm text-muted-foreground leading-relaxed">{generatedPrompt.reasoning}</p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs text-muted-foreground">Prompt — du kannst ihn ändern</label>
                    {chosenModel !== generatedPrompt.suggestedModel && (
                      <Badge variant="outline" className="text-xs">
                        Lukas wollte {generatedPrompt.suggestedModel}
                      </Badge>
                    )}
                  </div>
                  <Textarea
                    value={editedPrompt}
                    onChange={(e) => setEditedPrompt(e.target.value)}
                    className="min-h-[150px] text-sm resize-none"
                  />
                </div>

                {generatedPrompt.negativePrompt && (
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">Was vermieden werden soll</label>
                    <div className="bg-secondary/50 rounded p-3 text-xs text-muted-foreground">
                      {generatedPrompt.negativePrompt}
                    </div>
                  </div>
                )}

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground">Modell</label>
                    <select
                      value={chosenModel}
                      onChange={(e) => setChosenModel(e.target.value)}
                      className="w-full bg-secondary/50 rounded-full bg-white/[0.05] px-4 py-2.5 text-sm outline-none transition-colors focus:bg-white/[0.08]"
                    >
                      {modelle.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.id} — {m.wofuer}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground">Format</label>
                    <select
                      value={aspectRatio}
                      onChange={(e) => setAspectRatio(e.target.value)}
                      className="w-full bg-secondary/50 rounded-full bg-white/[0.05] px-4 py-2.5 text-sm outline-none transition-colors focus:bg-white/[0.08]"
                    >
                      {["16:9", "9:16", "1:1", "4:3", "3:4"].map((r) => (
                        <option key={r} value={r}>
                          {r}
                          {r === "9:16" ? " (Hochkant, TikTok/Reels)" : r === "16:9" ? " (Quer)" : ""}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Dauer gibt es nur beim Video. Bei einem Bild ergibt sie keinen Sinn. */}
                  {mediaType === "video" && (
                    <div className="space-y-1.5">
                      <label className="text-xs text-muted-foreground">Dauer in Sekunden</label>
                      <Input
                        type="number"
                        min={1}
                        max={60}
                        value={durationSec}
                        onChange={(e) => setDurationSec(Math.max(1, Number(e.target.value) || 1))}
                        className="text-sm"
                      />
                    </div>
                  )}
                </div>

                <div className="flex gap-3">
                  <Button variant="outline" onClick={handleReset} className="flex-1">
                    Zurück
                  </Button>
                  <Button onClick={handleGenerate} disabled={!editedPrompt.trim()} className="flex-1 gap-2">
                    <Send className="w-4 h-4" /> An Higgsfield senden
                  </Button>
                </div>
              </div>
            )}

            {/* Step 3: Generating */}
            {step === "generating" && (
              <div className="flex flex-col items-center justify-center py-16 space-y-6 animate-in fade-in duration-300">
                <div className="relative">
                  <div className="w-20 h-20 rounded-full border-2 border-primary/20 animate-pulse" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Loader2 className="w-8 h-8 text-primary animate-spin" />
                  </div>
                </div>
                <div className="text-center space-y-2">
                  <div className="font-bold text-lg">HIGGSFIELD RENDERT...</div>
                  <div className="text-sm text-muted-foreground">Deine Vision wird zum Leben erweckt</div>
                </div>
              </div>
            )}

            {/* Step 4: Done */}
            {step === "done" && (
              <div className="flex flex-col items-center justify-center py-12 space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
                <CheckCircle2 className="w-16 h-16 text-green-400" />
                <div className="text-center space-y-2">
                  <div className="font-bold text-lg">Auftrag läuft</div>
                  <div className="text-sm text-muted-foreground">Den Fortschritt siehst du in der Warteschlange</div>
                </div>
                <Button onClick={handleReset} className="gap-2">
                  <Wand2 className="w-4 h-4" /> NEUE VISION
                </Button>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Right: Job list */}
      <div className="w-full lg:w-80 shrink-0 flex flex-col">
        <div className="border-b border-border p-4">
          <h2 className="text-sm font-medium">Warteschlange</h2>
          <p className="text-xs text-muted-foreground mt-1">{jobs.length} Jobs total</p>
        </div>
        <ScrollArea className="lg:flex-1 p-4">
          <div className="space-y-3">
            {jobs.map((job) => (
              <JobCard key={job.id} job={job} />
            ))}
            {jobs.length === 0 && (
              <div className="text-center py-12">
                <Film className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-xs text-muted-foreground">Noch keine Aufträge</p>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
