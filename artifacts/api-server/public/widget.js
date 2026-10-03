/*
 * Lukas Widget v2 — einbettbarer, frei designbarer Chat/Voice-Assistent.
 *
 * Einbindung (eine Zeile):
 *   <script src="https://DEINE-LUKAS-DOMAIN/widget.js" data-api="https://DEINE-LUKAS-DOMAIN" defer></script>
 *
 * ── Design per data-Attributen ─────────────────────────────────────────────
 *   data-theme          "dark" (Standard) | "light"
 *   data-accent         Hauptfarbe, z.B. "#e11d48"
 *   data-accent2        zweite Gradient-Farbe des Buttons (Standard: accent)
 *   data-bg             Panel-Hintergrund        data-text   Textfarbe
 *   data-radius         Eckenradius, z.B. "0px" oder "24px" (nur Desktop —
 *                       auf Mobil ist das Panel bewusst randlos/vollflächig)
 *   data-position       "bottom-right" (Standard) | "bottom-left"
 *   data-width          Panelbreite  (Standard 380px, nur Desktop)
 *   data-height         Panelhöhe    (Standard 520px, nur Desktop)
 *   data-font           font-family
 *   data-button-icon    Emoji des Buttons (Standard 🤖)
 *   data-title          Titel        data-subtitle  Untertitel
 *   data-greeting       Begrüßung    data-placeholder  Eingabe-Platzhalter
 *
 * ── Voll-Custom per CSS ────────────────────────────────────────────────────
 * Kein Shadow-DOM: die Host-Seite kann mit normalem CSS ALLES überschreiben.
 * Stabile Klassen: .lukas-w .lukas-btn .lukas-panel .lukas-head .lukas-msgs
 * .lukas-m .lukas-m.u .lukas-m.a .lukas-form .lukas-in .lukas-ic .lukas-mic
 * CSS-Variablen: --lukas-accent --lukas-accent-2 --lukas-bg --lukas-panel-bg
 * --lukas-text --lukas-muted --lukas-border --lukas-radius --lukas-width
 * --lukas-height --lukas-font
 *
 * ── Stimme ─────────────────────────────────────────────────────────────────
 *   data-voice="agent"   OpenAI GPT Live API — direkte WebRTC-Verbindung im
 *                        Browser (keine externe SDK-Abhängigkeit), echtes
 *                        Speech-to-Speech, Millisekunden-Latenz. Aus
 *                        Kostenschutz-Gründen ist das Gespräch auf ein paar
 *                        Minuten pro Session gedeckelt.
 *   data-voice="classic" Browser-Spracherkennung + Server-TTS (Standard,
 *                        braucht keine Konfiguration).
 *   data-voice="off"     Mikro-Button ausblenden.
 */
(function () {
  "use strict";

  var script = document.currentScript;
  var ds = (script && script.dataset) || {};
  var API = (ds.api || (script ? new URL(script.src).origin : "")).replace(/\/+$/, "");

  var cfg = {
    theme: ds.theme === "light" ? "light" : "dark",
    accent: ds.accent || "#6d28d9",
    accent2: ds.accent2 || ds.accent || "#2563eb",
    bg: ds.bg || "",
    text: ds.text || "",
    radius: ds.radius || "20px",
    position: ds.position === "bottom-left" ? "left" : "right",
    width: ds.width || "380px",
    height: ds.height || "560px",
    font: ds.font || "system-ui,-apple-system,sans-serif",
    buttonIcon: ds.buttonIcon || "🤖",
    title: ds.title || "Lukas",
    subtitle: ds.subtitle || "Issas KI-Agent — frag mich was",
    greeting:
      ds.greeting ||
      "Hey! Ich bin Lukas, Issas KI-Agent. Frag mich etwas über ihn oder seine Projekte — tippen oder aufs Mikro drücken.",
    placeholder: ds.placeholder || "Frag mich etwas über Issa…",
    voice: ds.voice || "classic",
  };

  var themes = {
    dark: { bg: "#0c0c14", panel: "#15151f", text: "#eeeef4", muted: "#8d8da3", border: "#26263a", bubble: "#1c1c2a" },
    light: { bg: "#ffffff", panel: "#f6f6f9", text: "#16161f", muted: "#6b6b7c", border: "#e2e2ea", bubble: "#f0f0f4" },
  };
  var t = themes[cfg.theme];
  if (cfg.bg) t.bg = cfg.bg;
  if (cfg.text) t.text = cfg.text;

  // ── Styles (alles über Variablen; Host-CSS kann jede Klasse überschreiben)
  // Wichtig: Eingabefelder haben mind. 16px Schrift — darunter zoomt iOS
  // Safari beim Fokussieren automatisch in die Seite hinein (der Effekt, der
  // sich wie "das Panel ist rein-/rausgezoomt" anfühlt). Auf schmalen
  // Bildschirmen wird das Panel außerdem komplett vollflächig statt als
  // kleines schwebendes Fenster, in dem nicht alle Elemente gleichzeitig
  // sichtbar sind.
  var css =
    ".lukas-w{--lukas-accent:" + cfg.accent + ";--lukas-accent-2:" + cfg.accent2 + ";--lukas-bg:" + t.bg +
    ";--lukas-panel-bg:" + t.panel + ";--lukas-text:" + t.text + ";--lukas-muted:" + t.muted +
    ";--lukas-border:" + t.border + ";--lukas-bubble:" + t.bubble + ";--lukas-radius:" + cfg.radius +
    ";--lukas-width:" + cfg.width + ";--lukas-height:" + cfg.height + ";--lukas-font:" + cfg.font + ";" +
    "position:fixed;bottom:max(20px,env(safe-area-inset-bottom));" +
    (cfg.position === "left" ? "left:max(20px,env(safe-area-inset-left));" : "right:max(20px,env(safe-area-inset-right));") +
    "z-index:2147483000;font-family:var(--lukas-font)}" +
    ".lukas-w *{box-sizing:border-box}" +
    ".lukas-btn{width:60px;height:60px;border-radius:50%;border:none;cursor:pointer;background:linear-gradient(155deg,var(--lukas-accent),var(--lukas-accent-2));color:#fff;font-size:26px;box-shadow:0 10px 30px -6px rgba(0,0,0,.45),0 0 0 1px rgba(255,255,255,.08) inset;transition:transform .2s ease,box-shadow .2s ease}" +
    ".lukas-btn:hover{transform:scale(1.06);box-shadow:0 14px 36px -6px rgba(0,0,0,.5),0 0 0 1px rgba(255,255,255,.1) inset}" +
    ".lukas-btn:active{transform:scale(0.96)}" +
    ".lukas-btn.lukas-live{animation:lukas-pulse 1.2s infinite}" +
    ".lukas-panel{display:none;flex-direction:column;position:absolute;bottom:76px;" +
    (cfg.position === "left" ? "left:0;" : "right:0;") +
    "width:min(var(--lukas-width),calc(100vw - 32px));height:min(var(--lukas-height),calc(100vh - 120px));" +
    "background:var(--lukas-bg);color:var(--lukas-text);border:1px solid var(--lukas-border);border-radius:var(--lukas-radius);" +
    "overflow:hidden;box-shadow:0 24px 70px -16px rgba(0,0,0,.5),0 0 0 1px rgba(255,255,255,.04) inset}" +
    ".lukas-panel.open{display:flex}" +
    ".lukas-head{padding:14px 8px 14px 16px;background:var(--lukas-panel-bg);border-bottom:1px solid var(--lukas-border);display:flex;align-items:center;gap:10px;flex:none}" +
    ".lukas-head-info{flex:1;min-width:0}" +
    ".lukas-head b{font-size:14px;display:block;line-height:1.3}" +
    ".lukas-head span{font-size:11.5px;color:var(--lukas-muted);display:block;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
    ".lukas-dot{width:8px;height:8px;border-radius:50%;background:#22c55e;flex:none;box-shadow:0 0 0 3px rgba(34,197,94,.18)}" +
    ".lukas-close{flex:none;width:32px;height:32px;border-radius:50%;border:none;background:transparent;color:var(--lukas-muted);cursor:pointer;font-size:18px;line-height:1;display:flex;align-items:center;justify-content:center;transition:background .15s,color .15s}" +
    ".lukas-close:hover{background:var(--lukas-bubble);color:var(--lukas-text)}" +
    ".lukas-msgs{flex:1;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:16px;display:flex;flex-direction:column;gap:10px}" +
    ".lukas-m{max-width:85%;padding:10px 13px;border-radius:calc(var(--lukas-radius)*.65);font-size:14px;line-height:1.5;white-space:pre-wrap;word-break:break-word}" +
    ".lukas-m.u{align-self:flex-end;background:linear-gradient(155deg,var(--lukas-accent),var(--lukas-accent-2));color:#fff;border-bottom-right-radius:4px}" +
    ".lukas-m.a{align-self:flex-start;background:var(--lukas-bubble);border:1px solid var(--lukas-border);border-bottom-left-radius:4px}" +
    ".lukas-suggest{display:flex;flex-wrap:wrap;gap:6px;padding:0 16px 12px;flex:none}" +
    ".lukas-suggest:empty{display:none;padding:0}" +
    ".lukas-chip{border:1px solid var(--lukas-border);background:var(--lukas-bubble);color:var(--lukas-text);border-radius:999px;padding:7px 13px;font-size:12.5px;line-height:1.3;cursor:pointer;text-align:left;transition:border-color .15s,background .15s}" +
    ".lukas-chip:hover{border-color:var(--lukas-accent);background:var(--lukas-panel-bg)}" +
    ".lukas-status{font-size:11.5px;color:var(--lukas-muted);text-align:center;padding:0 12px 8px;flex:none}" +
    ".lukas-form{display:flex;align-items:center;gap:8px;padding:12px;padding-bottom:max(12px,env(safe-area-inset-bottom));border-top:1px solid var(--lukas-border);background:var(--lukas-panel-bg);flex:none}" +
    ".lukas-in{flex:1;min-width:0;background:var(--lukas-bg);border:1px solid var(--lukas-border);color:var(--lukas-text);border-radius:999px;padding:11px 15px;font-size:16px;outline:none;transition:border-color .15s}" +
    ".lukas-in:focus{border-color:var(--lukas-accent)}" +
    ".lukas-ic{width:40px;height:40px;flex:none;border-radius:50%;border:1px solid var(--lukas-border);background:var(--lukas-bubble);color:var(--lukas-text);cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;transition:background .15s,border-color .15s,transform .15s}" +
    ".lukas-ic:hover{border-color:var(--lukas-accent)}" +
    ".lukas-ic:active{transform:scale(0.94)}" +
    ".lukas-ic:disabled{opacity:.4;cursor:default;transform:none}" +
    ".lukas-ic.rec{background:#dc2626;border-color:#dc2626;color:#fff;animation:lukas-pulse 1s infinite}" +
    ".lukas-send{background:linear-gradient(155deg,var(--lukas-accent),var(--lukas-accent-2));border-color:transparent;color:#fff}" +
    "@keyframes lukas-pulse{50%{opacity:.55}}" +
    "@media (max-width:640px){" +
    ".lukas-panel{position:fixed;inset:0;width:100%;height:100dvh;height:100svh;border-radius:0;border-width:0}" +
    ".lukas-head{padding-top:max(14px,env(safe-area-inset-top))}" +
    ".lukas-close{width:36px;height:36px;font-size:20px}" +
    // Die fixierte Panel-Overlay-Schicht liegt später im DOM als der
    // schwebende Button, malt also sonst über ihn drüber — solange das
    // Panel (jetzt vollflächig) offen ist, braucht es den Button ohnehin
    // nicht, der eigene Schließen-Button im Header übernimmt das.
    ".lukas-panel.open ~ .lukas-btn{display:none}" +
    "}";
  var style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  // ── DOM ───────────────────────────────────────────────────────────────
  var root = document.createElement("div");
  root.className = "lukas-w";
  root.innerHTML =
    '<div class="lukas-panel">' +
    '<div class="lukas-head"><div class="lukas-dot"></div>' +
    '<div class="lukas-head-info"><b></b><span></span></div>' +
    '<button type="button" class="lukas-close" aria-label="Schließen">✕</button></div>' +
    '<div class="lukas-msgs"></div>' +
    '<div class="lukas-suggest"></div>' +
    '<div class="lukas-status" style="display:none"></div>' +
    '<form class="lukas-form">' +
    '<input class="lukas-in" autocomplete="off">' +
    '<button type="button" class="lukas-ic lukas-mic" title="Sprechen">🎤</button>' +
    '<button type="submit" class="lukas-ic lukas-send" title="Senden">➤</button>' +
    "</form></div>" +
    '<button class="lukas-btn"></button>';
  document.body.appendChild(root);

  root.querySelector(".lukas-head b").textContent = cfg.title;
  root.querySelector(".lukas-head span").textContent = cfg.subtitle;
  root.querySelector(".lukas-btn").textContent = cfg.buttonIcon;
  var panel = root.querySelector(".lukas-panel");
  var closeBtn = root.querySelector(".lukas-close");
  var msgs = root.querySelector(".lukas-msgs");
  var suggestBox = root.querySelector(".lukas-suggest");
  var statusBar = root.querySelector(".lukas-status");
  var form = root.querySelector(".lukas-form");
  var input = root.querySelector(".lukas-in");
  input.placeholder = cfg.placeholder;
  var micBtn = root.querySelector(".lukas-mic");
  var sendBtn = root.querySelector(".lukas-send");
  var mainBtn = root.querySelector(".lukas-btn");

  var history = [];
  var busy = false;
  var voiceMode = false;

  // ── Vorschlags-Chips: ein paar Starter-Fragen beim ersten Öffnen, danach
  // je EINE konkrete Folgefrage passend zur letzten Antwort (kommt vom
  // Server mit, siehe `suggestion` im SSE-Stream unten).
  var isEnglish = document.documentElement.lang && document.documentElement.lang.indexOf("en") === 0;
  var STARTER_QUESTIONS = isEnglish
    ? [
        "What is TaxiBB Essen?",
        "Tell me about GuardianGrid",
        "What are you working on right now?",
        "How did you build this portfolio?",
      ]
    : [
        "Was ist TaxiBB Essen?",
        "Erzähl mir von GuardianGrid",
        "Woran arbeitest du gerade?",
        "Wie hast du das Portfolio gebaut?",
      ];

  function renderChips(questions) {
    suggestBox.innerHTML = "";
    (questions || []).forEach(function (q) {
      if (!q) return;
      var b = document.createElement("button");
      b.type = "button";
      b.className = "lukas-chip";
      b.textContent = q;
      b.addEventListener("click", function () {
        voiceMode = false;
        send(q);
      });
      suggestBox.appendChild(b);
    });
  }

  // Erst der Mikro-Klick startet eine Sprachsitzung.
  var stopVoiceAgent = function () {};

  function setOpen(open) {
    panel.classList.toggle("open", open);
    if (open) {
      input.focus();
      if (!history.length) {
        addMsg("a", cfg.greeting);
        renderChips(STARTER_QUESTIONS);
      }
    } else {
      stopVoiceAgent();
    }
  }

  mainBtn.addEventListener("click", function () {
    setOpen(!panel.classList.contains("open"));
  });
  closeBtn.addEventListener("click", function () {
    setOpen(false);
  });

  function addMsg(role, text) {
    var el = document.createElement("div");
    el.className = "lukas-m " + (role === "user" ? "u" : "a");
    el.textContent = text;
    msgs.appendChild(el);
    msgs.scrollTop = msgs.scrollHeight;
    return el;
  }

  function setStatus(text) {
    statusBar.style.display = text ? "block" : "none";
    statusBar.textContent = text || "";
  }

  // Transkripte dienen nur der Anzeige. Der bestehende Filter blendet
  // überwiegend nichtlateinische ASR-Artefakte im deutschen Widget aus.
  // Das Sprachmodell hört unabhängig davon das Audio.
  function isHallucinatedTranscript(text) {
    var letters = text.match(/\p{L}/gu);
    // Zu kurz für eine belastbare Aussage — im Zweifel anzeigen.
    if (!letters || letters.length < 3) return false;
    var latin = text.match(/\p{Script=Latin}/gu);
    return (latin ? latin.length : 0) / letters.length < 0.5;
  }

  // ── Klassischer TTS-Pfad: progressive Wiedergabe über GET-URL ─────────
  var audioQueue = [];
  var playing = false;

  function playNext() {
    if (playing || audioQueue.length === 0) return;
    playing = true;
    var audio = new Audio(audioQueue.shift());
    audio.onended = audio.onerror = function () {
      playing = false;
      playNext();
    };
    audio.play().catch(function () {
      playing = false;
    });
  }

  function speak(sentence) {
    if (!voiceMode || !sentence.trim()) return;
    audioQueue.push(API + "/api/public/tts?text=" + encodeURIComponent(sentence.trim()));
    playNext();
  }

  // ── Text-Chat (SSE) ───────────────────────────────────────────────────
  function send(text) {
    if (busy || !text.trim()) return;
    busy = true;
    sendBtn.disabled = true;
    renderChips(null);
    addMsg("user", text);
    history.push({ role: "user", content: text });

    var el = addMsg("a", "…");
    var full = "";
    var spoken = 0;
    var followUp = null;

    fetch(API + "/api/public/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history }),
    })
      .then(function (res) {
        if (!res.ok || !res.body) throw new Error("chat " + res.status);
        var reader = res.body.getReader();
        var dec = new TextDecoder();
        var buf = "";
        function pump() {
          return reader.read().then(function (r) {
            if (r.value) {
              buf += dec.decode(r.value, { stream: !r.done });
              var lines = buf.split("\n");
              buf = lines.pop();
              lines.forEach(function (line) {
                if (line.indexOf("data: ") !== 0) return;
                try {
                  var p = JSON.parse(line.slice(6));
                  if (p.content) {
                    full += p.content;
                    el.textContent = full;
                    msgs.scrollTop = msgs.scrollHeight;
                    var rest = full.slice(spoken);
                    var m = rest.match(/^[\s\S]*?[.!?…](\s|$)/);
                    if (m) {
                      speak(m[0]);
                      spoken += m[0].length;
                    }
                  } else if (p.suggestion) {
                    followUp = p.suggestion;
                  }
                } catch (e) {}
              });
            }
            if (!r.done) return pump();
          });
        }
        return pump();
      })
      .then(function () {
        if (!full) {
          el.textContent = "Hmm, da ist etwas schiefgelaufen. Versuch es gleich nochmal.";
        } else {
          if (spoken < full.length) speak(full.slice(spoken));
          history.push({ role: "assistant", content: full });
          if (history.length > 20) history = history.slice(-20);
          if (followUp) renderChips([followUp]);
        }
      })
      .catch(function () {
        el.textContent = "Verbindung fehlgeschlagen — bitte später nochmal versuchen.";
      })
      .finally(function () {
        busy = false;
        sendBtn.disabled = false;
      });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    voiceMode = false;
    var v = input.value;
    input.value = "";
    send(v);
  });

  // ── Stimme ────────────────────────────────────────────────────────────
  if (cfg.voice === "off") {
    micBtn.style.display = "none";
  } else if (cfg.voice === "agent") {

    // GPT Live: SDP über Lukas; API-Schlüssel bleiben auf dem Server.
    var activeAgent = null;
    var SESSION_MAX_MS = 3 * 60 * 1000;
    function closeRemoteSession(session) {
      if (!session || !session.sessionId || !session.closeToken) return;
      fetch(API + "/api/public/live-session/" + encodeURIComponent(session.sessionId) + "/close", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ closeToken: session.closeToken }), keepalive: true,
      }).catch(function () {});
    }
    function stopAgent(agent) {
      agent = agent || activeAgent;
      if (!agent || agent.stopped) return;
      agent.stopped = true;
      if (activeAgent === agent) {
        activeAgent = null; micBtn.classList.remove("rec");
        mainBtn.classList.remove("lukas-live"); setStatus("");
      }
      if (agent.timer) window.clearTimeout(agent.timer);
      if (agent.connectTimer) window.clearTimeout(agent.connectTimer);
      if (agent.disconnectTimer) window.clearTimeout(agent.disconnectTimer);
      if (agent.dc) {
        try {
          if (agent.started && agent.dc.readyState === "open") agent.dc.send(JSON.stringify({ type: "session.close" }));
          agent.dc.close();
        } catch (e) {}
      }
      if (agent.pc) { try { agent.pc.close(); } catch (e) {} }
      if (agent.mic) agent.mic.getTracks().forEach(function (track) { track.stop(); });
      if (agent.audio) {
        try { agent.audio.pause(); } catch (e) {}
        agent.audio.srcObject = null; agent.audio.remove();
      }
      closeRemoteSession(agent.session);
    }
    stopVoiceAgent = function () { stopAgent(activeAgent); };
    window.addEventListener("pagehide", stopVoiceAgent);
    function markAgentReady(agent) {
      if (agent.stopped || !agent.started || agent.pc.connectionState !== "connected") return;
      if (agent.connectTimer) window.clearTimeout(agent.connectTimer);
      if (agent.disconnectTimer) window.clearTimeout(agent.disconnectTimer);
      agent.disconnectTimer = null;
      setStatus("Sprich einfach — Lukas hört zu."); mainBtn.classList.add("lukas-live");
    }
    function showLiveTranscript(agent, evt) {
      var role = evt.type === "session.input_transcript.delta" ? "user" : "assistant";
      if (typeof evt.delta !== "string" || !evt.delta) return;
      if (typeof evt.event_id === "string") {
        if (agent.eventIds.has(evt.event_id)) return;
        agent.eventIds.add(evt.event_id);
        if (agent.eventIds.size > 512) agent.eventIds.delete(agent.eventIds.values().next().value);
      }
      var start = typeof evt.start_ms === "number" ? evt.start_ms : null;
      var end = typeof evt.end_ms === "number" ? evt.end_ms : start;
      var segment = agent.transcripts[role];
      if (!segment || (start !== null && segment.end !== null &&
          (start < segment.start || start - segment.end > 750))) {
        segment = { text: "", element: null, start: start, end: end };
        agent.transcripts[role] = segment;
      }
      segment.text += evt.delta; segment.end = end;
      var hidden = role === "user" && isHallucinatedTranscript(segment.text);
      if (!segment.element && !hidden) segment.element = addMsg(role, "");
      if (segment.element) {
        segment.element.textContent = segment.text;
        segment.element.style.display = hidden ? "none" : "";
        msgs.scrollTop = msgs.scrollHeight;
      }
    }
    micBtn.addEventListener("click", function () {
      if (activeAgent) return stopAgent(activeAgent);
      var agent = {
        stopped: false, started: false, pc: null, dc: null, mic: null, audio: null, session: null,
        timer: null, connectTimer: null, disconnectTimer: null, transcripts: {}, eventIds: new Set(),
      };
      activeAgent = agent; micBtn.classList.add("rec"); setStatus("Verbinde…");
      agent.connectTimer = window.setTimeout(function () {
        if (activeAgent !== agent || agent.stopped) return;
        stopAgent(agent); addMsg("a", "Die Sprachverbindung dauert zu lange. Bitte erneut versuchen.");
      }, 30000);
      var micPromise = navigator.mediaDevices && navigator.mediaDevices.getUserMedia
        ? navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
        : Promise.reject(new Error("Dieser Browser unterstützt kein Mikrofon."));
      micPromise.then(function (stream) {
        if (agent.stopped) { stream.getTracks().forEach(function (track) { track.stop(); }); return; }
        agent.mic = stream; agent.pc = new RTCPeerConnection();
        agent.audio = document.createElement("audio"); agent.audio.autoplay = true;
        agent.audio.setAttribute("playsinline", ""); agent.audio.style.display = "none";
        document.body.appendChild(agent.audio);
        agent.pc.ontrack = function (event) {
          if (agent.stopped) return;
          agent.audio.srcObject = event.streams[0] || new MediaStream([event.track]);
          agent.audio.play().catch(function () {
            if (!agent.stopped) setStatus("Ton im Browser freigeben, um Lukas zu hören.");
          });
        };
        agent.pc.onconnectionstatechange = function () {
          if (agent.stopped) return;
          if (agent.pc.connectionState === "connected") markAgentReady(agent);
          else if (agent.pc.connectionState === "failed" || agent.pc.connectionState === "closed") {
            stopAgent(agent); addMsg("a", "Die Sprachverbindung wurde beendet.");
          } else if (agent.pc.connectionState === "disconnected" && !agent.disconnectTimer) {
            setStatus("Verbindung wird wiederhergestellt…");
            agent.disconnectTimer = window.setTimeout(function () { stopAgent(agent); }, 10000);
          }
        };
        stream.getAudioTracks().forEach(function (track) { agent.pc.addTrack(track, stream); });
        agent.dc = agent.pc.createDataChannel("oai-events");
        agent.dc.addEventListener("message", function (event) {
          if (agent.stopped) return;
          var evt; try { evt = JSON.parse(event.data); } catch (e) { return; }
          if (!evt || typeof evt.type !== "string") return;
          if (evt.type === "session.started") { agent.started = true; markAgentReady(agent); }
          else if (evt.type === "session.input_transcript.delta" || evt.type === "session.output_transcript.delta") showLiveTranscript(agent, evt);
          else if (evt.type === "session.closed") stopAgent(agent);
          else if (evt.type === "error") {
            stopAgent(agent); addMsg("a", "Die Sprachverbindung ist fehlgeschlagen. Bitte erneut versuchen.");
          }
        });
        agent.dc.addEventListener("close", function () { stopAgent(agent); });
        agent.dc.addEventListener("error", function () {
          stopAgent(agent); addMsg("a", "Die Sprachverbindung ist fehlgeschlagen. Bitte erneut versuchen.");
        });
        return agent.pc.createOffer().then(function (offer) {
          if (agent.stopped) return null;
          return agent.pc.setLocalDescription(offer).then(function () { return offer; });
        }).then(function (offer) {
          if (!offer || agent.stopped) return null;
          return fetch(API + "/api/public/live-session", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sdp: offer.sdp }),
          }).then(function (response) {
            if (!response.ok) throw new Error("Sprachverbindung fehlgeschlagen (" + response.status + ")");
            return response.json();
          });
        }).then(function (session) {
          if (!session) return;
          agent.session = session;
          if (agent.stopped) { closeRemoteSession(session); return; }
          if (typeof session.sdp !== "string" || !session.sessionId || !session.closeToken) throw new Error("Ungültige Antwort für die Sprachverbindung.");
          agent.timer = window.setTimeout(function () {
            stopAgent(agent); addMsg("a", "Die Zeit für dieses Gespräch ist um — gerne nochmal starten!");
          }, SESSION_MAX_MS);
          return agent.pc.setRemoteDescription({ type: "answer", sdp: session.sdp });
        });
      }).catch(function (err) {
        if (agent.stopped) return;
        stopAgent(agent); addMsg("a", "Voice nicht verfügbar: " + (err && err.message ? err.message : "unbekannt"));
      });
    });
  } else {
    // Klassisch: Browser-Spracherkennung + Server-TTS
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      micBtn.style.display = "none";
    } else {
      var rec = new SR();
      rec.lang =
        document.documentElement.lang && document.documentElement.lang.indexOf("en") === 0 ? "en-US" : "de-DE";
      rec.interimResults = true;
      var recActive = false;

      rec.onresult = function (e) {
        var txt = "";
        for (var i = 0; i < e.results.length; i++) txt += e.results[i][0].transcript;
        input.value = txt;
        if (e.results[e.results.length - 1].isFinal) {
          rec.stop();
          voiceMode = true;
          var v = input.value;
          input.value = "";
          send(v);
        }
      };
      rec.onend = function () {
        recActive = false;
        micBtn.classList.remove("rec");
      };
      rec.onerror = rec.onend;

      micBtn.addEventListener("click", function () {
        if (recActive) return rec.stop();
        recActive = true;
        micBtn.classList.add("rec");
        rec.start();
      });
    }
  }
})();
