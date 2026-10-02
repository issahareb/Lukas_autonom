import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import fs from "fs";
import router from "./routes";
import whatsappRouter from "./routes/whatsapp";
import { telefonWebhookRouter } from "./routes/telefon";
import { lukasAuth } from "./middlewares/auth";
import { korsRegeln, sicherheitsKopfzeilen, apiDrossel } from "./middlewares/schutz";
import { logger } from "./lib/logger";

const app: Express = express();

// "X-Powered-By: Express" in jeder Antwort ist eine kostenlose Auskunft an
// jeden, der nach Zielen sucht. Sie nuetzt niemandem ausser ihm.
app.disable("x-powered-by");

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
/*
 * Kopfzeilen und Herkunft, bevor irgendetwas anderes laeuft.
 *
 * Hier stand `app.use(cors())` — jede Webseite der Welt durfte im Browser
 * eines Angemeldeten diese API aufrufen und die Antwort lesen. Der Token hat
 * es aufgefangen; die Tuer stand trotzdem offen. Der oeffentliche Teil
 * (/api/public/*, Webhooks) bleibt bewusst offen, alles andere ist auf den
 * eigenen Host plus LUKAS_ALLOWED_ORIGINS beschraenkt — Details in
 * middlewares/schutz.ts.
 */
app.use(sicherheitsKopfzeilen);
app.use(cors(korsRegeln));
app.use(apiDrossel);
// Rohen Body mitschneiden: die WhatsApp-Webhook-Signatur (HMAC-SHA256) wird
// ueber die exakten Bytes gebildet — nach dem JSON-Parsen laesst sie sich
// nicht mehr zuverlaessig nachrechnen.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
    },
  }),
);
app.use(express.urlencoded({ extended: false, verify: (req, _res, buf) => {
  (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
} }));

// widget.js ändert sich während aktiver Entwicklung häufig — Browser dürfen
// es nie ungefragt aus dem Cache servieren, sonst testet man versehentlich
// eine alte Version (genau das hat schon zu falschen Fehlerbildern geführt).
app.use("/widget.js", (req, res, next) => {
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  next();
});

// Statische Widget-Dateien (widget.js, embed-demo.html); __dirname kommt aus
// dem esbuild-Banner und zeigt auf artifacts/api-server/dist.
app.use(express.static(path.join(__dirname, "..", "public")));

// Meta muss den WhatsApp-Webhook OHNE unseren privaten Bearer-Token erreichen.
// Deshalb wird ausschließlich der WhatsApp-Router VOR der Lukas-API-Auth
// gemountet. Der POST bleibt durch Metas X-Hub-Signature-256 + App Secret
// geschützt; die GET-Verifizierung durch WHATSAPP_VERIFY_TOKEN.
// So kann /api/whatsapp/webhook nicht mehr versehentlich von lukasAuth mit
// "Unauthorized" abgefangen werden.
app.use("/api", whatsappRouter);

// Aus demselben Grund der Telefon-Webhook: OpenAI ruft ihn bei einem
// eingehenden Anruf auf und kann keinen privaten Bearer-Token mitschicken.
// Geschuetzt ist er stattdessen durch die signierte Zustellung — ohne gueltige
// Signatur wird nicht einmal die call_id gelesen.
app.use("/api", telefonWebhookRouter);

// Alle übrigen privaten API-Routen bleiben hinter LUKAS_API_TOKEN.
app.use("/api", lukasAuth, router);

// Im Deployment (Railway etc.) liefert der API-Server auch das gebaute
// Dashboard (lukas-ui) aus — ein Service für API + UI + Widget.
// Im Dev-Betrieb läuft die UI weiter über den Vite-Dev-Server (npm run dev:ui).
const uiDist = path.join(__dirname, "..", "..", "lukas-ui", "dist", "public");
if (fs.existsSync(path.join(uiDist, "index.html"))) {
  /*
   * index.html darf NIE aus dem Cache kommen.
   *
   * Vite hasht die gebauten JS/CSS-Dateien nach Inhalt (z.B. index-a1b2c3.js)
   * — die duerfen also unbegrenzt gecacht werden, ein neuer Build hat sowieso
   * einen neuen Dateinamen. index.html selbst traegt aber KEINEN Hash im
   * Namen, und referenziert genau diese Dateinamen. Cacht ein Browser
   * index.html, zeigt er dauerhaft auf die alten, ausgemusterten JS-Dateien —
   * ein neuer Deploy aendert daran nichts, weil die Seite den neuen Build nie
   * anfragt. Genau das fuehrte dazu, dass ein neuer Dashboard-Tab auf einem
   * Mobilgeraet nicht auftauchte, obwohl der Deploy laengst durch war.
   */
  app.use(
    express.static(uiDist, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith("index.html")) {
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        } else {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    }),
  );
  // SPA-Fallback: Client-Routen (/chat, /goals, …) liefern index.html
  app.get(/^\/(?!api\/).*/, (req, res) => {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.sendFile(path.join(uiDist, "index.html"));
  });
  logger.info({ uiDist }, "Dashboard-UI wird mit ausgeliefert");
} else {
  logger.info("Dashboard-UI nicht gebaut (npm run build:ui) — nur API + Widget");
}

export default app;
