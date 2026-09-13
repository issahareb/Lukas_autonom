import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { Network, Download, Loader2, Search, X, RotateCcw } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Knoten = {
  id: string;
  art: string;
  titel: string;
  gewicht: number;
  text: string;
  daten: Record<string, string | number | boolean>;
  datei: string;
  ordner: string;
};
type Kante = { von: string; nach: string; art: string; gewicht: number };
type Gehirn = { stand: string; knoten: Knoten[]; kanten: Kante[]; zahlen: Record<string, number> };

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("lukas_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/*
 * Farben nach Art. Nicht Dekoration: der Graph hat vierzehn Arten von Knoten,
 * und ohne Farbe ist er eine graue Wolke, in der man nur noch Groesse sieht.
 */
const FARBEN: Record<string, number> = {
  identitaet: 0xffffff,
  gefuehl: 0xf472b6,
  ziel: 0xfbbf24,
  erinnerung: 0x60a5fa,
  kategorie: 0x38bdf8,
  thema: 0x34d399,
  agent: 0xc084fc,
  subjekt: 0xa3e635,
  aussage: 0x94a3b8,
  episode: 0xfb923c,
  episodenart: 0xfdba74,
  strategie: 0xfacc15,
  mitarbeiter: 0x2dd4bf,
  tagebuch: 0x818cf8,
  meldung: 0xef4444,
};
const HEX = (art: string) => `#${(FARBEN[art] ?? 0x94a3b8).toString(16).padStart(6, "0")}`;

const WORT: Record<string, string> = {
  identitaet: "Er selbst",
  gefuehl: "Gefühle",
  ziel: "Ziele",
  erinnerung: "Erinnerungen",
  kategorie: "Kategorien",
  thema: "Themen",
  agent: "Agenten",
  subjekt: "Subjekte",
  aussage: "Aussagen",
  episode: "Episoden",
  episodenart: "Episodenarten",
  strategie: "Strategien",
  mitarbeiter: "Team",
  tagebuch: "Tagebuch",
  meldung: "Meldungen",
};

/*
 * Wer beschriftet werden darf, und in welcher Reihenfolge.
 *
 * Das ist die Lehre aus der flachen Fassung: "beschrifte alles ab Gewicht X"
 * ergab einen Textteppich, in dem sich hundert Aussagen gegenseitig
 * ueberschrieben. Namen bekommen deshalb nur die ORIENTIERUNGSPUNKTE — er
 * selbst, Themen, Kategorien, Ziele, Agenten. Alles andere liest man, indem
 * man es anklickt.
 */
const VORRANG: Record<string, number> = {
  identitaet: 0,
  thema: 1,
  kategorie: 1,
  ziel: 2,
  agent: 2,
  meldung: 2,
  mitarbeiter: 3,
  gefuehl: 3,
  strategie: 4,
  subjekt: 4,
  episodenart: 4,
};

const HINTERGRUND = 0x05080f;

type Lage = { x: Float32Array; y: Float32Array; z: Float32Array };

/*
 * Kraefte-Layout in DREI Dimensionen (Fruchterman-Reingold).
 *
 * Kanten ziehen, Knoten stossen sich ab. In der Ebene musste sich alles
 * ausweichen, was zusammengehoert — bei tausend Knoten wurde daraus ein
 * Teppich. Im Raum gibt es eine Richtung mehr, in die die Cluster
 * auseinandergehen koennen; deshalb sieht man hier ueberhaupt erst, dass es
 * Cluster sind.
 *
 * Die Abstossung wird ueber ein Gitter genaehert: jeder Knoten sieht nur die
 * 27 Zellen um sich herum. Ohne das waeren es bei 1000 Knoten eine Million
 * Paare pro Schritt.
 *
 * Gerechnet wird EINMAL, nicht in jedem Bild. Ein Graph, der ewig
 * weiterzappelt, sieht lebendig aus und ist zum Lesen unbrauchbar.
 */
function lege(knoten: Knoten[], kanten: Kante[]): { lage: Lage; k: number } {
  const n = knoten.length;
  const k = Math.cbrt(1e9 / Math.max(n, 1)) / 2.2;
  const idx = new Map(knoten.map((kn, i) => [kn.id, i]));
  const px = new Float32Array(n);
  const py = new Float32Array(n);
  const pz = new Float32Array(n);
  const vx = new Float32Array(n);
  const vy = new Float32Array(n);
  const vz = new Float32Array(n);

  // Masse nach Grad: ein Thema mit dreissig Erinnerungen daran braucht mehr
  // Platz als eine einzelne Erinnerung, sonst liegt der Orientierungspunkt
  // mitten im Knäuel.
  const masse = new Float32Array(n).fill(1);
  for (const e of kanten) {
    const a = idx.get(e.von);
    const b = idx.get(e.nach);
    if (a !== undefined) masse[a] += 0.6;
    if (b !== undefined) masse[b] += 0.6;
  }

  // Startlage auf einer Fibonacci-Kugel: gleichmässig im Raum verteilt und bei
  // gleichen Daten immer gleich — sonst sähe der Graph bei jedem Laden anders
  // aus.
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const phi = Math.acos(1 - 2 * t);
    const theta = Math.PI * (1 + Math.sqrt(5)) * i;
    const r = k * 1.6 * Math.cbrt(i + 1);
    px[i] = r * Math.sin(phi) * Math.cos(theta);
    py[i] = r * Math.sin(phi) * Math.sin(theta);
    pz[i] = r * Math.cos(phi);
  }

  const paare: [number, number, number][] = [];
  for (const e of kanten) {
    const a = idx.get(e.von);
    const b = idx.get(e.nach);
    if (a !== undefined && b !== undefined) paare.push([a, b, e.gewicht]);
  }

  const zelle = k * 2;
  let temperatur = k * 1.4;
  // Weniger Schritte, wenn es viele Knoten sind — sonst wartet man beim Öffnen.
  const schritte = Math.max(150, Math.min(340, Math.round(420000 / Math.max(n, 1))));

  for (let s = 0; s < schritte; s++) {
    vx.fill(0);
    vy.fill(0);
    vz.fill(0);

    const gitter = new Map<string, number[]>();
    for (let i = 0; i < n; i++) {
      const key = `${Math.floor(px[i] / zelle)},${Math.floor(py[i] / zelle)},${Math.floor(pz[i] / zelle)}`;
      const l = gitter.get(key);
      if (l) l.push(i);
      else gitter.set(key, [i]);
    }

    for (let i = 0; i < n; i++) {
      const cx = Math.floor(px[i] / zelle);
      const cy = Math.floor(py[i] / zelle);
      const cz = Math.floor(pz[i] / zelle);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            for (const j of gitter.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
              if (i === j) continue;
              let ex = px[i] - px[j];
              let ey = py[i] - py[j];
              let ez = pz[i] - pz[j];
              let d2 = ex * ex + ey * ey + ez * ez;
              if (d2 < 0.01) {
                ex = (i % 7) - 3;
                ey = (j % 7) - 3;
                ez = ((i + j) % 7) - 3;
                d2 = ex * ex + ey * ey + ez * ez || 1;
              }
              const kraft = ((k * k) / d2) * Math.sqrt(masse[i] * masse[j]);
              vx[i] += ex * kraft;
              vy[i] += ey * kraft;
              vz[i] += ez * kraft;
            }
          }
        }
      }
    }

    for (const [a, b, g] of paare) {
      const ex = px[a] - px[b];
      const ey = py[a] - py[b];
      const ez = pz[a] - pz[b];
      const d = Math.sqrt(ex * ex + ey * ey + ez * ez) || 0.01;
      const kraft = ((d * d) / k) * (0.4 + g * 0.6);
      const fx = (ex / d) * kraft;
      const fy = (ey / d) * kraft;
      const fz = (ez / d) * kraft;
      vx[a] -= fx;
      vy[a] -= fy;
      vz[a] -= fz;
      vx[b] += fx;
      vy[b] += fy;
      vz[b] += fz;
    }

    // Schwache Schwerkraft zur Mitte, damit einzelne Inseln nicht davonfliegen.
    for (let i = 0; i < n; i++) {
      vx[i] -= px[i] * 0.006;
      vy[i] -= py[i] * 0.006;
      vz[i] -= pz[i] * 0.006;
    }

    for (let i = 0; i < n; i++) {
      const d = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i] + vz[i] * vz[i]) || 1;
      const schritt = Math.min(d, temperatur);
      px[i] += (vx[i] / d) * schritt;
      py[i] += (vy[i] / d) * schritt;
      pz[i] += (vz[i] / d) * schritt;
    }
    temperatur *= 0.98;
  }

  return { lage: { x: px, y: py, z: pz }, k };
}

export default function GehirnSeite() {
  const [daten, setDaten] = useState<Gehirn | null>(null);
  const [laedt, setLaedt] = useState(true);
  const [rechnet, setRechnet] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [lade, setLade] = useState(false);
  const [gewaehlt, setGewaehlt] = useState<Knoten | null>(null);
  const [suche, setSuche] = useState("");
  const [aus, setAus] = useState<Set<string>>(new Set());

  const huelle = useRef<HTMLDivElement | null>(null);
  const schilder = useRef<HTMLDivElement | null>(null);
  const welt = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    kugeln: THREE.InstancedMesh;
    linien: THREE.LineSegments;
    lage: Lage;
    radius: Float32Array;
    zurueck: () => void;
    male: () => void;
    fokus: (id: string | null) => void;
  } | null>(null);

  // Refs statt State: die Zeichenschleife läuft 60× pro Sekunde und darf
  // React nicht anfassen.
  const sichtbarRef = useRef<Set<string>>(new Set());
  const nachbarnRef = useRef<Set<string> | null>(null);
  const trefferRef = useRef<Set<string> | null>(null);
  const gewaehltRef = useRef<string | null>(null);

  useEffect(() => {
    fetch(`${BASE}/api/lukas/gehirn`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((g: Gehirn) => {
        setRechnet(true);
        setDaten(g);
      })
      .catch((e) => setFehler(e instanceof Error ? e.message : String(e)))
      .finally(() => setLaedt(false));
  }, []);

  const sichtbar = useMemo(() => {
    if (!daten) return new Set<string>();
    return new Set(daten.knoten.filter((k) => !aus.has(k.art)).map((k) => k.id));
  }, [daten, aus]);

  const nachbarn = useMemo(() => {
    if (!daten || !gewaehlt) return null;
    const s = new Set<string>([gewaehlt.id]);
    for (const e of daten.kanten) {
      if (e.von === gewaehlt.id) s.add(e.nach);
      if (e.nach === gewaehlt.id) s.add(e.von);
    }
    return s;
  }, [daten, gewaehlt]);

  const treffer = useMemo(() => {
    const q = suche.trim().toLowerCase();
    if (!q || !daten) return null;
    return new Set(
      daten.knoten.filter((k) => `${k.titel} ${k.text}`.toLowerCase().includes(q)).map((k) => k.id),
    );
  }, [suche, daten]);

  // ── Die Welt aufbauen ─────────────────────────────────────────────────────
  useEffect(() => {
    const box = huelle.current;
    if (!daten || !box) return;
    let abgebrochen = false;
    let aufraeumen: (() => void) | null = null;

    // Erst zeichnen lassen ("wird gerechnet"), dann rechnen — sonst hängt das
    // Bild schwarz da, während der Browser das Layout löst.
    const t = setTimeout(() => {
      if (abgebrochen) return;
      const { lage, k } = lege(daten.knoten, daten.kanten);
      const n = daten.knoten.length;
      const idx = new Map(daten.knoten.map((kn, i) => [kn.id, i]));

      const scene = new THREE.Scene();
      // Nebel statt harter Kante: was weiter hinten liegt, verliert sich —
      // genau daran erkennt das Auge Tiefe.
      scene.fog = new THREE.FogExp2(HINTERGRUND, 0.00035 / (k / 30));

      const camera = new THREE.PerspectiveCamera(58, box.clientWidth / box.clientHeight, 1, 400000);
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(box.clientWidth, box.clientHeight);
      renderer.setClearColor(HINTERGRUND, 1);
      box.appendChild(renderer.domElement);
      renderer.domElement.style.touchAction = "none";

      scene.add(new THREE.AmbientLight(0xffffff, 1.25));
      const licht = new THREE.DirectionalLight(0xffffff, 1.6);
      licht.position.set(1, 1.4, 1);
      scene.add(licht);
      const gegenlicht = new THREE.DirectionalLight(0x88aaff, 0.7);
      gegenlicht.position.set(-1, -0.6, -1);
      scene.add(gegenlicht);

      // ── Knoten als Kugeln ──────────────────────────────────────────────
      const radius = new Float32Array(n);
      daten.knoten.forEach((kn, i) => {
        radius[i] = k * (0.1 + kn.gewicht * 0.22) * (kn.art === "identitaet" ? 1.8 : 1);
      });

      const kugeln = new THREE.InstancedMesh(
        // Kugel statt Ikosaeder: der Ikosaeder hat harte Facetten, und beim
        // Heranfliegen sah ein Knoten aus wie ein geschliffener Stein.
        new THREE.SphereGeometry(1, 20, 14),
        new THREE.MeshLambertMaterial({ color: 0xffffff }),
        n,
      );
      kugeln.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(kugeln);

      // ── Kanten ─────────────────────────────────────────────────────────
      const m = daten.kanten.length;
      const punkte = new Float32Array(m * 6);
      const farben = new Float32Array(m * 6);
      daten.kanten.forEach((e, i) => {
        const a = idx.get(e.von)!;
        const b = idx.get(e.nach)!;
        punkte.set([lage.x[a], lage.y[a], lage.z[a], lage.x[b], lage.y[b], lage.z[b]], i * 6);
      });
      const linienGeo = new THREE.BufferGeometry();
      linienGeo.setAttribute("position", new THREE.BufferAttribute(punkte, 3));
      linienGeo.setAttribute("color", new THREE.BufferAttribute(farben, 3));
      const linien = new THREE.LineSegments(
        linienGeo,
        new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5 }),
      );
      scene.add(linien);

      // ── Kamera einpassen ───────────────────────────────────────────────
      let r = 1;
      for (let i = 0; i < n; i++) {
        r = Math.max(r, Math.hypot(lage.x[i], lage.y[i], lage.z[i]));
      }
      /*
       * Kamera-Abstand über die ENGERE der beiden Öffnungen. Auf dem Handy ist
       * das Bild hochkant: horizontal sieht die Kamera dort viel weniger als
       * vertikal, und mit dem vertikalen Winkel gerechnet stand man mitten im
       * Knäuel statt davor.
       */
      const oeffnungHoch = (camera.fov * Math.PI) / 180;
      const oeffnungBreit = 2 * Math.atan(Math.tan(oeffnungHoch / 2) * camera.aspect);
      const abstand = (r / Math.sin(Math.min(oeffnungHoch, oeffnungBreit) / 2)) * 0.62;
      camera.position.set(abstand * 0.35, abstand * 0.28, abstand * 0.9);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.rotateSpeed = 0.55;
      controls.zoomToCursor = true;
      // Weit rein und weit raus: das Bild bleibt scharf, weil hier nichts
      // vergrößert wird — die Kamera fährt wirklich hinein.
      controls.minDistance = k * 0.4;
      controls.maxDistance = abstand * 6;
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.32;
      controls.target.set(0, 0, 0);
      controls.update();

      // ── Namensschilder als HTML ────────────────────────────────────────
      // Bewusst kein Text in der 3D-Szene: eine Textur wird beim Hineinzoomen
      // matschig. HTML bleibt in jeder Entfernung gestochen scharf.
      const tafel = schilder.current!;
      tafel.innerHTML = "";
      const pool: HTMLDivElement[] = [];
      // Auf einem schmalen Bild sind sechzehn Namen zu viel — dort weniger.
      const schilderZahl = box.clientWidth < 640 ? 9 : 16;
      for (let i = 0; i < schilderZahl; i++) {
        const d = document.createElement("div");
        d.className =
          "absolute -translate-y-1/2 px-1.5 py-0.5 rounded-md bg-slate-950/75 text-[11px] leading-tight whitespace-nowrap pointer-events-none";
        d.style.display = "none";
        tafel.appendChild(d);
        pool.push(d);
      }

      const kandidaten = [...daten.knoten]
        .sort((a, b) => (VORRANG[a.art] ?? 9) - (VORRANG[b.art] ?? 9) || b.gewicht - a.gewicht)
        .slice(0, 90);

      // ── Farben und Sichtbarkeit ────────────────────────────────────────
      const grundfarbe = daten.knoten.map((kn) => new THREE.Color(FARBEN[kn.art] ?? 0x94a3b8));
      const hilfsMatrix = new THREE.Matrix4();
      const hilfsFarbe = new THREE.Color();

      const male = () => {
        const gewaehltId = gewaehltRef.current;
        const nb = nachbarnRef.current;
        const tf = trefferRef.current;
        const sicht = sichtbarRef.current;

        for (let i = 0; i < n; i++) {
          const kn = daten.knoten[i];
          const zeigen = sicht.has(kn.id);
          const gedimmt = (nb && !nb.has(kn.id)) || (tf && !tf.has(kn.id));
          const gross = gewaehltId === kn.id ? 1.7 : 1;
          hilfsMatrix.makeScale(
            zeigen ? radius[i] * gross : 0,
            zeigen ? radius[i] * gross : 0,
            zeigen ? radius[i] * gross : 0,
          );
          hilfsMatrix.setPosition(lage.x[i], lage.y[i], lage.z[i]);
          kugeln.setMatrixAt(i, hilfsMatrix);
          hilfsFarbe.copy(grundfarbe[i]);
          if (gedimmt) hilfsFarbe.multiplyScalar(0.09);
          kugeln.setColorAt(i, hilfsFarbe);
        }
        kugeln.instanceMatrix.needsUpdate = true;
        if (kugeln.instanceColor) kugeln.instanceColor.needsUpdate = true;

        daten.kanten.forEach((e, i) => {
          const a = idx.get(e.von)!;
          const b = idx.get(e.nach)!;
          const zeigen = sicht.has(e.von) && sicht.has(e.nach);
          const hell = !nb || (nb.has(e.von) && nb.has(e.nach));
          const helligkeit = !zeigen ? 0 : hell ? 0.5 : 0.02;
          for (let s = 0; s < 2; s++) {
            const c = grundfarbe[s === 0 ? a : b];
            farben.set(
              [c.r * helligkeit, c.g * helligkeit, c.b * helligkeit],
              i * 6 + s * 3,
            );
          }
        });
        linienGeo.attributes.color.needsUpdate = true;
      };

      // ── Schleife ───────────────────────────────────────────────────────
      /*
       * Anflug auf den gewaehlten Knoten.
       *
       * In einer Kugel aus tausend Punkten findet man den angeklickten sonst
       * nicht wieder — erst recht nicht, wenn man ihn ueber die Liste der
       * Verbindungen gewechselt hat. Die Kamera schwenkt deshalb auf ihn und
       * geht dicht heran, statt dass er irgendwo im Knaeuel hell wird.
       */
      let flug: { ziel: THREE.Vector3; abstand: number } | null = null;
      const richtung = new THREE.Vector3();

      const v = new THREE.Vector3();
      let bild = 0;
      renderer.setAnimationLoop(() => {
        if (flug) {
          controls.target.lerp(flug.ziel, 0.12);
          richtung.copy(camera.position).sub(controls.target).normalize();
          const jetzt = camera.position.distanceTo(controls.target);
          camera.position
            .copy(controls.target)
            .add(richtung.multiplyScalar(jetzt + (flug.abstand - jetzt) * 0.12));
          if (controls.target.distanceTo(flug.ziel) < k * 0.05 && Math.abs(jetzt - flug.abstand) < k * 0.1) {
            flug = null;
          }
        }
        controls.update();
        renderer.render(scene, camera);

        if (bild++ % 3 !== 0) return;
        const w = box.clientWidth;
        const h = box.clientHeight;
        const belegt: [number, number, number, number][] = [];
        let benutzt = 0;

        const sortiert = kandidaten
          .filter((kn) => sichtbarRef.current.has(kn.id))
          .map((kn) => {
            const i = idx.get(kn.id)!;
            v.set(lage.x[i], lage.y[i], lage.z[i]);
            const abst = camera.position.distanceTo(v);
            v.project(camera);
            return { kn, i, abst, x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h, z: v.z };
          })
          .filter((e) => e.z < 1 && e.x > 0 && e.x < w && e.y > 0 && e.y < h)
          .sort((a, b) => a.abst - b.abst);

        for (const e of sortiert) {
          if (benutzt >= pool.length) break;
          const nb = nachbarnRef.current;
          if (nb && !nb.has(e.kn.id)) continue;
          const breite = e.kn.titel.length * 6.4 + 10;
          const kasten: [number, number, number, number] = [e.x + 8, e.y - 9, breite, 18];
          if (
            belegt.some(
              (o) =>
                kasten[0] < o[0] + o[2] &&
                kasten[0] + kasten[2] > o[0] &&
                kasten[1] < o[1] + o[3] &&
                kasten[1] + kasten[3] > o[1],
            )
          )
            continue;
          belegt.push(kasten);
          const d = pool[benutzt++];
          d.textContent = e.kn.titel.length > 28 ? `${e.kn.titel.slice(0, 27)}…` : e.kn.titel;
          d.style.display = "block";
          d.style.transform = `translate(${Math.round(e.x + 8)}px, ${Math.round(e.y)}px)`;
          d.style.color = e.kn.art === "identitaet" ? "#fff" : "rgba(226,232,240,0.92)";
          d.style.fontWeight = e.kn.art === "identitaet" ? "600" : "400";
          d.style.opacity = String(Math.max(0.35, 1 - e.abst / (abstand * 2.5)));
        }
        for (let i = benutzt; i < pool.length; i++) pool[i].style.display = "none";
      });

      // ── Anklicken ──────────────────────────────────────────────────────
      const strahl = new THREE.Raycaster();
      const maus = new THREE.Vector2();
      let start: { x: number; y: number; t: number } | null = null;

      const runter = (e: PointerEvent) => {
        start = { x: e.clientX, y: e.clientY, t: Date.now() };
        controls.autoRotate = false;
      };
      const hoch = (e: PointerEvent) => {
        if (!start) return;
        const gezogen = Math.hypot(e.clientX - start.x, e.clientY - start.y) > 6;
        start = null;
        if (gezogen) return;

        const b = renderer.domElement.getBoundingClientRect();
        maus.set(((e.clientX - b.left) / b.width) * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1);
        strahl.setFromCamera(maus, camera);
        const treffer3d = strahl.intersectObject(kugeln);
        const getroffen = treffer3d.find(
          (h) => h.instanceId !== undefined && sichtbarRef.current.has(daten.knoten[h.instanceId].id),
        );
        if (getroffen?.instanceId !== undefined) {
          setGewaehlt(daten.knoten[getroffen.instanceId]);
          return;
        }

        // Auf dem Handy trifft man eine kleine Kugel selten genau — deshalb
        // zusätzlich der nächste Knoten im Umkreis von 26 Pixeln.
        let beste: Knoten | null = null;
        let bestD = 26;
        for (let i = 0; i < n; i++) {
          if (!sichtbarRef.current.has(daten.knoten[i].id)) continue;
          v.set(lage.x[i], lage.y[i], lage.z[i]).project(camera);
          if (v.z > 1) continue;
          const sx = (v.x * 0.5 + 0.5) * b.width;
          const sy = (-v.y * 0.5 + 0.5) * b.height;
          const d = Math.hypot(sx - (e.clientX - b.left), sy - (e.clientY - b.top));
          if (d < bestD) {
            bestD = d;
            beste = daten.knoten[i];
          }
        }
        setGewaehlt(beste);
      };
      renderer.domElement.addEventListener("pointerdown", runter);
      renderer.domElement.addEventListener("pointerup", hoch);

      const beobachter = new ResizeObserver(() => {
        camera.aspect = box.clientWidth / box.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(box.clientWidth, box.clientHeight);
      });
      beobachter.observe(box);

      welt.current = {
        renderer,
        scene,
        camera,
        controls,
        kugeln,
        linien,
        lage,
        radius,
        male,
        fokus: (id: string | null) => {
          const i = id === null ? undefined : idx.get(id);
          if (i === undefined) return;
          controls.autoRotate = false;
          flug = {
            ziel: new THREE.Vector3(lage.x[i], lage.y[i], lage.z[i]),
            abstand: Math.max(k * 2.2, radius[i] * 16),
          };
        },
        zurueck: () => {
          controls.target.set(0, 0, 0);
          camera.position.set(abstand * 0.35, abstand * 0.28, abstand * 0.9);
          controls.update();
        },
      };
      male();
      setRechnet(false);

      aufraeumen = () => {
        beobachter.disconnect();
        renderer.domElement.removeEventListener("pointerdown", runter);
        renderer.domElement.removeEventListener("pointerup", hoch);
      };
    }, 30);

    return () => {
      abgebrochen = true;
      clearTimeout(t);
      aufraeumen?.();
      const w = welt.current;
      if (w) {
        w.renderer.setAnimationLoop(null);
        w.controls.dispose();
        w.kugeln.geometry.dispose();
        (w.kugeln.material as THREE.Material).dispose();
        w.linien.geometry.dispose();
        (w.linien.material as THREE.Material).dispose();
        w.renderer.dispose();
        w.renderer.domElement.remove();
        welt.current = null;
      }
      if (schilder.current) schilder.current.innerHTML = "";
    };
  }, [daten]);

  // Auswahl, Suche und Filter wirken auf die schon gebaute Welt — nichts wird
  // neu gerechnet, die Anordnung bleibt stehen.
  useEffect(() => {
    sichtbarRef.current = sichtbar;
    nachbarnRef.current = nachbarn;
    trefferRef.current = treffer;
    gewaehltRef.current = gewaehlt?.id ?? null;
    welt.current?.male();
  }, [sichtbar, nachbarn, treffer, gewaehlt]);

  // Getrennt vom Einfärben: der Anflug soll nur bei einem WECHSEL des Knotens
  // starten, nicht wenn man nebenbei einen Filter umlegt.
  useEffect(() => {
    if (gewaehlt) welt.current?.fokus(gewaehlt.id);
  }, [gewaehlt]);

  const vaultLaden = async () => {
    setLade(true);
    try {
      const r = await fetch(`${BASE}/api/lukas/gehirn/vault.zip`, { headers: authHeaders() });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `lukas-gehirn-${(daten?.stand ?? new Date().toISOString()).slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e));
    } finally {
      setLade(false);
    }
  };

  const arten = useMemo(() => {
    if (!daten) return [] as [string, number][];
    return Object.entries(daten.zahlen)
      .filter(([a]) => a !== "knoten" && a !== "kanten")
      .sort((a, b) => b[1] - a[1]) as [string, number][];
  }, [daten]);

  const zuruecksetzen = useCallback(() => {
    setGewaehlt(null);
    welt.current?.zurueck();
  }, []);

  return (
    <div className="flex flex-col h-full min-h-0">
      <PageHeader
        icon={Network}
        title="Gehirn"
        subtitle={
          daten
            ? `${daten.zahlen.knoten} Knoten · ${daten.zahlen.kanten} Kanten · Stand ${daten.stand.slice(0, 16).replace("T", " ")}`
            : "Knoten und Kanten seines Gedächtnisses"
        }
        actions={
          <Button onClick={vaultLaden} disabled={!daten || lade} size="sm" className="gap-2">
            {lade ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Obsidian-Vault
          </Button>
        }
      />

      <div className="px-5 sm:px-6 pt-4 space-y-3">
        <div className="relative max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={suche}
            onChange={(e) => setSuche(e.target.value)}
            placeholder="Im Gehirn suchen…"
            className="h-10 w-full rounded-full bg-white/[0.05] pl-10 pr-4 text-sm outline-none transition-colors focus:bg-white/[0.08]"
          />
        </div>

        {/*
          Legende und Filter in einem: ein Klick blendet eine Art aus.
          Auf dem Handy eine einzige Zeile zum Wischen — umgebrochen waren es
          fünf Reihen, und vom Graphen blieb kaum noch etwas übrig.
        */}
        <div className="flex gap-1.5 overflow-x-auto sm:flex-wrap sm:overflow-visible pb-1 -mx-1 px-1">
          {arten.map(([art, anzahl]) => {
            const an = !aus.has(art);
            return (
              <button
                key={art}
                onClick={() =>
                  setAus((v) => {
                    const n = new Set(v);
                    if (n.has(art)) n.delete(art);
                    else n.add(art);
                    return n;
                  })
                }
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs transition-all shrink-0 ${
                  an ? "border-border bg-secondary/50" : "border-border/50 opacity-40"
                }`}
              >
                <span className="w-2 h-2 rounded-full" style={{ background: HEX(art) }} />
                {WORT[art] ?? art}
                <span className="text-muted-foreground">{anzahl}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="relative m-5 mt-4 min-h-[440px] flex-1 overflow-hidden rounded-3xl bg-white/[0.02] ring-1 ring-white/[0.06] sm:m-6">
        <div ref={huelle} className="absolute inset-0" />
        <div ref={schilder} className="absolute inset-0 overflow-hidden pointer-events-none" />

        {(laedt || rechnet) && (
          <div className="absolute inset-0 grid place-items-center bg-background/70 text-sm text-muted-foreground gap-2">
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              {rechnet ? "Der Raum wird sortiert…" : "Lädt…"}
            </div>
          </div>
        )}
        {fehler && !laedt && (
          <div className="absolute inset-0 grid place-items-center text-sm text-red-400 px-6 text-center">
            Der Graph kam nicht durch: {fehler}
          </div>
        )}

        {daten && !rechnet && (
          <div className="absolute left-3 bottom-3 flex items-center gap-2">
            <button
              onClick={zuruecksetzen}
              className="glass flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Ansicht zurück
            </button>
            <span className="text-[11px] text-muted-foreground/70 hidden sm:inline">
              ziehen = drehen · scrollen = hinein · zwei Finger = schieben
            </span>
          </div>
        )}

        {gewaehlt && (
          <div className="absolute right-3 top-3 bottom-3 w-80 max-w-[85%] card-soft rise p-4 overflow-y-auto">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: HEX(gewaehlt.art) }}
                />
                {WORT[gewaehlt.art] ?? gewaehlt.art}
              </div>
              <button
                onClick={() => setGewaehlt(null)}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Schliessen"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/*
              Bei einer Erinnerung ist der Titel nur der abgeschnittene Anfang
              des Textes. Beides untereinander zu zeigen hiess denselben Satz
              zweimal zu lesen — dann lieber nur den ganzen.
            */}
            {gewaehlt.text.startsWith(gewaehlt.titel.replace(/…$/, "")) ? (
              <p className="mt-2 text-sm whitespace-pre-wrap text-pretty leading-relaxed">
                {gewaehlt.text}
              </p>
            ) : (
              <>
                <h3 className="mt-2 font-medium text-pretty leading-snug">{gewaehlt.titel}</h3>
                {gewaehlt.text && (
                  <p className="mt-2 text-sm text-muted-foreground whitespace-pre-wrap text-pretty leading-relaxed">
                    {gewaehlt.text}
                  </p>
                )}
              </>
            )}

            {Object.keys(gewaehlt.daten).length > 0 && (
              <dl className="mt-3 space-y-1 text-xs">
                {Object.entries(gewaehlt.daten).map(([f, v]) => (
                  <div key={f} className="flex gap-2">
                    <dt className="text-muted-foreground shrink-0">{f}</dt>
                    <dd className="ml-auto text-right break-words">{String(v)}</dd>
                  </div>
                ))}
              </dl>
            )}

            {daten && (
              <div className="mt-4">
                <div className="text-xs text-muted-foreground mb-1.5">Verbindungen</div>
                <div className="space-y-1">
                  {daten.kanten
                    .filter((e) => e.von === gewaehlt.id || e.nach === gewaehlt.id)
                    .slice(0, 40)
                    .map((e, i) => {
                      const anderer = daten.knoten.find(
                        (k) => k.id === (e.von === gewaehlt.id ? e.nach : e.von),
                      );
                      if (!anderer) return null;
                      return (
                        <button
                          key={i}
                          onClick={() => setGewaehlt(anderer)}
                          className="w-full text-left text-xs px-2 py-1.5 rounded-lg hover:bg-secondary/70 flex items-center gap-2"
                        >
                          <span
                            className="w-1.5 h-1.5 rounded-full shrink-0"
                            style={{ background: HEX(anderer.art) }}
                          />
                          <span className="text-muted-foreground shrink-0">{e.art}</span>
                          <span className="truncate">{anderer.titel}</span>
                        </button>
                      );
                    })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
