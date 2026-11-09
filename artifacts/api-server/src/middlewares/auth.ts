import type { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger";
import { gleicherToken } from "./schutz";

/*
 * Bearer-Auth fuer die private API.
 *
 * Immer offen bleiben:
 *   /healthz            Railways Healthcheck — sonst killt die Plattform das Deployment
 *   /public/*           Portfolio-Widget, hat ein eigenes Rate-Limit
 *   /whatsapp/webhook   Meta kann keinen Bearer-Token mitschicken; abgesichert
 *                       ist der Endpunkt durch die HMAC-Signaturpruefung
 *                       (X-Hub-Signature-256) und die Absender-Allowlist.
 *   /lukas/mcp/callback OAuth-Rueckleitung aus dem Browser, nachdem Issa sich
 *                       bei einem MCP-Anbieter angemeldet hat. Traegt aus
 *                       demselben Grund keinen Token; abgesichert ueber den
 *                       einmaligen state-Parameter, den wir beim Start des
 *                       Vorgangs erzeugt und in der Serverzeile hinterlegt
 *                       haben.
 */
function isOpenPath(path: string): boolean {
  return (
    path === "/healthz" ||
    path.startsWith("/public/") ||
    path === "/whatsapp/webhook" ||
    path === "/lukas/mcp/callback"
  );
}

let warnedAboutMissingToken = false;

export function lukasAuth(req: Request, res: Response, next: NextFunction): void {
  if (isOpenPath(req.path)) return void next();

  // .trim(): manche Provider-UIs (z.B. Railways Variablen-Editor) haengen beim
  // Speichern einen Zeilenumbruch an den Wert an. Fuer diesen Zugangscode ist
  // das kein Sicherheitsproblem, also tolerieren wir Rand-Whitespace bewusst,
  // statt Nutzer:innen daran verzweifeln zu lassen.
  const readToken = process.env.LUKAS_USAGE_READ_TOKEN?.trim();
  const auth = req.headers.authorization;
  const readProvided = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : undefined;
  if (req.method === "GET" && ["/lukas/verbrauch", "/lukas/verbrauch/fallstudie"].includes(req.path) && readToken && gleicherToken(readProvided,readToken)) return void next();
  const token = process.env.LUKAS_API_TOKEN?.trim();

  if (!token) {
    /*
     * Ohne Token war hier frueher alles offen — die Auth hat sich bei fehlender
     * Konfiguration selbst abgeschaltet. Hinter diesen Routen liegen Issas
     * Erinnerungen, Ziele, Tagebuch, Anhaenge und Lukas' Tools inklusive Shell
     * und Mailversand. Ein vergessenes oder beim Umzug verlorenes Secret haette
     * das alles offen ins Netz gestellt, ohne dass irgendetwas kaputt aussieht.
     *
     * Geschlossen ist deshalb der Normalfall. Geoeffnet wird nur, wenn jemand
     * NODE_ENV ausdruecklich auf "development" setzt — das macht das dev-Skript
     * dieses Pakets, sonst niemand.
     *
     * Bewusst NICHT andersherum ("schliessen, wenn NODE_ENV=production"): dann
     * haette eine Plattform, die diese Variable einfach nicht setzt, alles
     * wieder geoeffnet, und man haette es nicht gemerkt. Eine Schutzmassnahme
     * darf nicht davon abhaengen, dass irgendwo eine Variable richtig steht.
     */
    if (process.env.NODE_ENV !== "development") {
      if (!warnedAboutMissingToken) {
        warnedAboutMissingToken = true;
        logger.error(
          "LUKAS_API_TOKEN fehlt — die private API bleibt geschlossen. Variable setzen und neu deployen.",
        );
      }
      return void res
        .status(503)
        .json({ error: "Private API ist nicht konfiguriert (LUKAS_API_TOKEN fehlt)" });
    }
    return void next();
  }

  const header = req.headers.authorization;
  const provided = header?.startsWith("Bearer ") ? header.slice(7).trim() : undefined;
  if (!gleicherToken(provided, token)) {
    return void res.status(401).json({ error: "Unauthorized" });
  }
  next();
}
