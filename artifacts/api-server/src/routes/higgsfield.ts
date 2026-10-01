import { Router } from "express";
import { db } from "@workspace/db";
import { mediaJobsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { HIGGSFIELD_PROMPT_SYSTEM } from "../lib/lukas-soul.js";
import { recordEmotion } from "../lib/emotion-engine";
import { logger } from "../lib/logger";
import { recordDebugEvent } from "../lib/debug-log";
import {
  findServerWithTool,
  callMcpTool,
  extractMediaUrl,
  extractJobId,
  pollMcpJob,
  importMediaUrl,
} from "../lib/mcp";
import { directRoute } from "../lib/ai/model-router";
import { callLukasModel } from "../lib/ai/model-client";
import {
  resolveHiggsfieldModel,
  higgsfieldMediaType,
  HIGGSFIELD_MODELS,
} from "../lib/higgsfield-models";

const router = Router();

const HIGGSFIELD_BASE = "https://platform.higgsfield.ai";

function getHiggsfieldAuth(): string | null {
  return process.env.HIGGSFIELD_API_KEY ?? null;
}

// ── GENERATE PROMPT ────────────────────────────────────────────────────────
router.post("/higgsfield/generate-prompt", async (req, res) => {
  try {
    const { vision, mediaType, style, imageUrl, model } = req.body;
    if (!vision || !mediaType)
      return void res.status(400).json({ error: "vision and mediaType required" });

    const userPrompt = `Erstelle einen perfekten Higgsfield-Prompt für folgende Vision:

VISION: "${vision}"
MEDIA-TYP: ${mediaType === "video" ? "Video (image-to-video)" : "Bild (text-to-image)"}
${style ? `STIL-HINT: ${style}` : ""}
${imageUrl ? `REFERENZ-BILD: ${imageUrl} (wird als Basis für Video verwendet)` : ""}
${model ? `GEWÜNSCHTES MODELL: ${model}` : ""}

Erstelle einen cinematischen, detaillierten Prompt auf Englisch der das Beste aus Higgsfield herausholt.
Antworte NUR mit dem JSON-Objekt.`;

    const response = await callLukasModel({
      route: directRoute("general"),
      maxTokens: 4096,
      messages: [
        { role: "system", content: HIGGSFIELD_PROMPT_SYSTEM },
        { role: "user", content: userPrompt },
      ],
    });

    const text = response.content;

    let parsed: Record<string, unknown>;
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
    } catch {
      return void res.status(500).json({ error: "Failed to parse AI response", raw: text });
    }

    /*
     * Was das Modell vorschlaegt, wird hier auf etwas Gueltiges gezogen.
     *
     * Zwei Dinge, die Issa aufgefallen sind: erstens stand bei einem BILD eine
     * Dauer — sinnlos, ein Bild hat keine. Sie kam schlicht daher, dass der
     * Wert des Modells ungeprueft durchgereicht wurde. Zweitens muss der
     * Modellname im MCP-Katalog existieren; ein frei erfundener Name faellt
     * sonst erst beim Generieren auf.
     */
    const typ = mediaType === "video" ? "video" : "image";
    res.json({
      prompt: parsed.prompt ?? "",
      negativePrompt: parsed.negativePrompt ?? null,
      suggestedModel: resolveHiggsfieldModel(typ, parsed.suggestedModel as string | undefined),
      aspectRatio: parsed.aspectRatio ?? "16:9",
      duration: typ === "video" ? Number(parsed.duration ?? 5) : null,
      reasoning: parsed.reasoning ?? "",
    });
  } catch (err: unknown) {
    console.error("Prompt generation error:", err);
    res.status(500).json({ error: "Failed to generate prompt" });
  }
});

// ── GENERATE MEDIA ─────────────────────────────────────────────────────────
router.post("/higgsfield/generate", async (req, res) => {
  try {
    const { model, prompt, imageUrl, aspectRatio, duration, resolution, vision } = req.body;
    if (!model || !prompt)
      return void res.status(400).json({ error: "model and prompt required" });

    /*
     * "video" im Namen zu suchen hat funktioniert, solange die Modellnamen
     * lange Pfade waren ("...image-to-video"). Die Katalog-IDs heissen
     * seedance_2_5 oder soul_2 — da steht nichts von Video drin.
     */
    const mediaType = higgsfieldMediaType(model);
    const apiKey = getHiggsfieldAuth();

    const [job] = await db
      .insert(mediaJobsTable)
      .values({
        model,
        prompt,
        vision: vision ?? null,
        status: "pending",
        mediaType,
        requestId: null,
        resultUrl: null,
      })
      .returning();

    /*
     * Zuerst MCP.
     *
     * Das Studio rief Higgsfield direkt per REST-API und eigenem Schluessel
     * auf, obwohl daneben eine fertige MCP-Verbindung mit OAuth stand. Zwei
     * Wege zum selben Anbieter, von denen nur einer gepflegt wird, laufen
     * frueher oder spaeter auseinander — und der Schluessel-Weg braucht einen
     * zusaetzlichen Zugang, den man separat erneuern muss.
     *
     * Ist kein MCP-Server verbunden, bleibt der alte Weg als Rueckfall. Wer
     * bisher nur den Schluessel gesetzt hat, merkt von der Umstellung nichts.
     */
    const viaMcp = await findServerWithTool(
      mediaType === "video" ? "generate_video" : "generate_image",
    ).catch(() => null);

    if (viaMcp) {
      try {
        /*
         * Die Argumente muessen dem MCP-Schema entsprechen, nicht dem alten
         * REST-Body. Drei konkrete Unterschiede, an denen es gescheitert ist:
         *
         *  - "model" ist Pflicht und muss eine Katalog-ID sein.
         *  - "image_url" und "resolution" gibt es dort nicht. Ein Referenzbild
         *    geht ueber medias[] mit einer media_id, ausdruecklich NICHT als
         *    https-Adresse — dafuer muss die URL vorher importiert werden.
         *  - "duration" existiert nur beim Video.
         */
        const katalogModell = resolveHiggsfieldModel(mediaType, model);
        const args: Record<string, unknown> = { prompt, model: katalogModell };
        if (aspectRatio) args.aspect_ratio = aspectRatio;
        if (duration && mediaType === "video") args.duration = Number(duration);

        if (imageUrl) {
          const mediaId = await importMediaUrl(viaMcp.server.id, String(imageUrl));
          if (mediaId) {
            args.medias = [{ value: mediaId, role: mediaType === "video" ? "start_image" : "image" }];
          } else {
            // Lieber ohne Referenzbild generieren als mit einem Feld, das der
            // Server verwirft — aber sichtbar, statt es zu verschlucken.
            logger.warn({ imageUrl }, "Referenzbild nicht importierbar, generiere ohne");
          }
        }

        const text = await callMcpTool(viaMcp.server.id, viaMcp.tool, args);

        /*
         * MCP-Antworten sind Text. Zwei Faelle:
         *  - Die Antwort enthaelt schon die fertige Datei -> fertig.
         *  - Sie enthaelt eine Auftragsnummer -> die MUSS mit in die requestId,
         *    sonst kann spaeter niemand mehr nachfragen. Genau daran hing ein
         *    Bild 20 Minuten auf "processing": ohne Nummer gab es nichts, womit
         *    man haette nachfassen koennen.
         */
        const url = extractMediaUrl(text);
        const jobId = url ? null : extractJobId(text);
        const requestId = `mcp:${viaMcp.server.id}:${jobId ?? ""}`;

        // Ohne URL und ohne Nummer kann nie etwas nachkommen — dann ist der
        // Auftrag gescheitert und sagt das, statt ewig zu laufen.
        const status = url ? "completed" : jobId ? "processing" : "failed";

        await db
          .update(mediaJobsTable)
          .set({
            requestId,
            status,
            resultUrl: url ?? null,
            error:
              status === "failed"
                ? `Der MCP-Server hat weder eine Datei noch eine Auftragsnummer zurückgegeben. Antwort war:\n${text.slice(0, 900)}`
                : null,
            updatedAt: new Date(),
          })
          .where(eq(mediaJobsTable.id, job.id));
        job.requestId = requestId;
        job.status = status;
        job.resultUrl = url ?? null;

        return void res.status(202).json({
          ...job,
          createdAt: job.createdAt.toISOString(),
          updatedAt: job.updatedAt.toISOString(),
        });
      } catch (mcpErr) {
        const reason = `MCP-Server "${viaMcp.server.name}": ${
          mcpErr instanceof Error ? mcpErr.message : String(mcpErr)
        }`;
        logger.error({ err: mcpErr, model }, reason);
        recordDebugEvent("higgsfield/generate", reason);
        await db
          .update(mediaJobsTable)
          .set({ status: "failed", error: reason, updatedAt: new Date() })
          .where(eq(mediaJobsTable.id, job.id));
        job.status = "failed";
        job.error = reason;
        return void res.status(202).json({
          ...job,
          createdAt: job.createdAt.toISOString(),
          updatedAt: job.updatedAt.toISOString(),
        });
      }
    }

    if (apiKey) {
      try {
        const body: Record<string, unknown> = { prompt };
        if (imageUrl) body.image_url = imageUrl;
        if (aspectRatio) body.aspect_ratio = aspectRatio;
        if (duration && mediaType === "video") body.duration = duration;
        if (resolution) body.resolution = resolution;

        const response = await fetch(`${HIGGSFIELD_BASE}/${model}`, {
          method: "POST",
          headers: {
            Authorization: `Key ${apiKey}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(body),
        });

        if (response.ok) {
          const data = (await response.json()) as Record<string, unknown>;
          const requestId = (data.id ?? data.request_id ?? data.requestId) as string | undefined;
          if (requestId) {
            await db
              .update(mediaJobsTable)
              .set({ requestId, status: "processing", updatedAt: new Date() })
              .where(eq(mediaJobsTable.id, job.id));
            job.requestId = requestId;
            job.status = "processing";
          }
        } else {
          const errText = await response.text().catch(() => "");
          const reason = `Higgsfield API ${response.status}: ${errText.slice(0, 400) || "(keine Antwort)"}`;
          logger.error({ status: response.status, model }, reason);
          recordDebugEvent("higgsfield/generate", reason);
          await db
            .update(mediaJobsTable)
            .set({ status: "failed", error: reason, updatedAt: new Date() })
            .where(eq(mediaJobsTable.id, job.id));
          job.status = "failed";
          job.error = reason;
        }
      } catch (apiErr) {
        const reason = `Higgsfield nicht erreichbar: ${apiErr instanceof Error ? apiErr.message : String(apiErr)}`;
        logger.error({ err: apiErr, model }, reason);
        recordDebugEvent("higgsfield/generate", reason);
        await db
          .update(mediaJobsTable)
          .set({ status: "failed", error: reason, updatedAt: new Date() })
          .where(eq(mediaJobsTable.id, job.id));
        job.status = "failed";
        job.error = reason;
      }
    } else {
      // Weder MCP-Verbindung noch Schluessel — ehrlich als failed markieren
      // statt den Job für immer auf "processing" hängen zu lassen.
      const reason =
        "Kein Weg zu Higgsfield: unter „MCP“ ist kein Server mit generate_image/generate_video verbunden, und HIGGSFIELD_API_KEY ist auch nicht gesetzt.";
      recordDebugEvent("higgsfield/generate", reason);
      await db
        .update(mediaJobsTable)
        .set({ status: "failed", error: reason, updatedAt: new Date() })
        .where(eq(mediaJobsTable.id, job.id));
      job.status = "failed";
      job.error = reason;
    }

    res.status(202).json({
      ...job,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
    });
  } catch (err) {
    console.error("Generate media error:", err);
    res.status(500).json({ error: "Failed to submit generation request" });
  }
});

// ── STATUS ─────────────────────────────────────────────────────────────────
/*
 * Der Modellkatalog fuer das Studio.
 *
 * Das Dashboard soll die Auswahl anzeigen koennen, ohne die Liste ein zweites
 * Mal zu fuehren — zwei Listen laufen frueher oder spaeter auseinander, und
 * genau daran ist die alte Modellwahl gescheitert.
 */
router.get("/higgsfield/models", (_req, res) => {
  res.json(HIGGSFIELD_MODELS);
});

router.get("/higgsfield/status/:requestId", async (req, res) => {
  try {
    const { requestId } = req.params;
    const apiKey = getHiggsfieldAuth();

    const [job] = await db
      .select()
      .from(mediaJobsTable)
      .where(eq(mediaJobsTable.requestId, requestId));

    if (!job) return void res.status(404).json({ error: "Job not found" });

    /*
     * Auftraege ueber MCP tragen "mcp:<serverId>:<auftragsnummer>". Die
     * Nummer gehoert nicht der Higgsfield-REST-API — dort nachzufragen wuerde
     * jedes Mal in einen 404 laufen.
     *
     * Stattdessen wird beim MCP-Server selbst nachgefragt. Das hatte ich beim
     * ersten Wurf komplett vergessen: der Auftrag ging auf "processing" und
     * blieb dort fuer immer, weil niemand mehr nachfasste.
     */
    const ueberMcp = job.requestId?.startsWith("mcp:") ?? false;

    if (ueberMcp && job.status === "processing" && job.requestId) {
      const [, serverIdText, jobId] = job.requestId.split(":");
      const serverId = Number.parseInt(serverIdText ?? "", 10);

      const abbrechen = async (grund: string) => {
        await db
          .update(mediaJobsTable)
          .set({ status: "failed", error: grund, updatedAt: new Date() })
          .where(eq(mediaJobsTable.id, job.id));
        job.status = "failed";
        job.error = grund;
      };

      if (!Number.isInteger(serverId) || !jobId) {
        /*
         * Auftraege aus der ersten Fassung tragen nur "mcp:<slug>" — ohne
         * Auftragsnummer gibt es nichts, wonach man fragen koennte. Genau
         * so ein Auftrag drehte 20 Minuten lang.
         */
        await abbrechen(
          "Dieser Auftrag stammt aus einer älteren Fassung ohne Auftragsnummer — es lässt sich nicht mehr nachfragen, ob er fertig wurde. Bitte neu starten.",
        );
      } else {
        try {
          const url = await pollMcpJob(serverId, jobId);
          if (url) {
            await db
              .update(mediaJobsTable)
              .set({ status: "completed", resultUrl: url, error: null, updatedAt: new Date() })
              .where(eq(mediaJobsTable.id, job.id));
            job.status = "completed";
            job.resultUrl = url;
          } else if (Date.now() - job.createdAt.getTime() > 20 * 60 * 1000) {
            // Nach 20 Minuten ohne Ergebnis ist es kein "laeuft noch" mehr.
            // Ein Auftrag, der nie einen Endzustand erreicht, ist schlimmer
            // als einer, der ehrlich scheitert.
            await abbrechen(
              "Seit über 20 Minuten kein Ergebnis vom MCP-Server. Der Auftrag gilt als gescheitert — schau in der Diagnose nach Details.",
            );
          }
        } catch (err) {
          logger.warn({ err, requestId: job.requestId }, "MCP-Statusabfrage fehlgeschlagen");
        }
      }
    }

    if (!ueberMcp && apiKey && job.status === "processing" && job.requestId) {
      try {
        const response = await fetch(
          `${HIGGSFIELD_BASE}/requests/${job.requestId}/status`,
          { headers: { Authorization: `Key ${apiKey}` } }
        );

        if (response.ok) {
          const data = (await response.json()) as Record<string, unknown>;
          const newStatus = data.status as string | undefined;
          const outputUrl = (data.output ?? data.result ?? data.url) as string | undefined;

          let mapped = job.status;
          if (newStatus === "succeeded" || newStatus === "completed") mapped = "completed";
          else if (newStatus === "failed") mapped = "failed";
          else if (newStatus === "processing" || newStatus === "in-progress") mapped = "processing";

          if (mapped !== job.status || outputUrl) {
            // Fertige Kreationen freuen Lukas, gescheiterte wurmen ihn
            // (job.status ist hier immer "processing" — jeder Wechsel ist neu).
            if (mapped === "completed") {
              recordEmotion({
                emotion: "joy",
                valence: 0.4,
                intensity: 0.4,
                cause: `${job.mediaType === "video" ? "Video" : "Bild"} fertig generiert: ${(job.vision ?? job.prompt).slice(0, 80)}`,
                source: "media",
              }).catch(() => {});
            } else if (mapped === "failed") {
              recordEmotion({
                emotion: "frustration",
                valence: -0.4,
                intensity: 0.4,
                cause: `Media-Generierung fehlgeschlagen: ${(job.vision ?? job.prompt).slice(0, 80)}`,
                source: "media",
              }).catch(() => {});
            }
            const [updated] = await db
              .update(mediaJobsTable)
              .set({
                status: mapped,
                resultUrl: outputUrl ?? job.resultUrl,
                updatedAt: new Date(),
              })
              .where(eq(mediaJobsTable.id, job.id))
              .returning();
            return void res.json({
              ...updated,
              createdAt: updated.createdAt.toISOString(),
              updatedAt: updated.updatedAt.toISOString(),
            });
          }
        }
      } catch {}
    }

    res.json({
      ...job,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to get status" });
  }
});

// ── ALL JOBS ───────────────────────────────────────────────────────────────
router.get("/higgsfield/jobs", async (req, res) => {
  try {
    const jobs = await db
      .select()
      .from(mediaJobsTable)
      .orderBy(desc(mediaJobsTable.createdAt))
      .limit(50);

    res.json(
      jobs.map((j) => ({
        ...j,
        createdAt: j.createdAt.toISOString(),
        updatedAt: j.updatedAt.toISOString(),
      }))
    );
  } catch (err) {
    res.status(500).json({ error: "Failed to get jobs" });
  }
});

export default router;
