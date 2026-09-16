import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { BEREICHE, hash, istHub, type Gehirn, type Raum } from "./modell";

export type Ansicht = {
  sichtbar: Set<string>;
  umfeld: Map<string, number>;
  treffer: Set<string> | null;
  auswahl: string | null;
  bewegung: boolean;
};
export type Szene = {
  update: (a: Ansicht) => void;
  fokus: (id: string | null) => void;
  zoom: (faktor: number) => void;
  eintauchen: (id: string) => void;
  dispose: () => void;
};
const BG = 0x050912;
const VERTEX = `
  attribute vec3 tint; attribute float alpha; varying vec3 vTint; varying float vAlpha;
  void main() { vTint=tint; vAlpha=alpha; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }
`;
const FRAGMENT = `
  varying vec3 vTint; varying float vAlpha;
  void main() { if(vAlpha<.001) discard; gl_FragColor=vec4(vTint,vAlpha); }
`;

export function erschaffeSzene(
  box: HTMLDivElement,
  labels: HTMLDivElement,
  g: Gehirn,
  r: Raum,
  waehle: (id: string | null) => void,
  fehler: (text: string) => void,
): Szene {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: "low-power",
  });
  renderer.setClearColor(BG, 1);
  const narrow = box.clientWidth < 640;
  let pixelRatio = Math.min(window.devicePixelRatio || 1, narrow ? 1.5 : 2);
  renderer.setPixelRatio(pixelRatio);
  box.appendChild(renderer.domElement);
  renderer.domElement.setAttribute(
    "aria-label",
    "Räumliche Gedächtniskarte. Einträge sind auch über Suche und Liste erreichbar.",
  );
  renderer.domElement.setAttribute("role", "img");
  renderer.domElement.style.touchAction = "none";
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(44, 1, 0.1, 5000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.rotateSpeed = 0.42;
  controls.zoomSpeed = 0.65;
  controls.enableZoom = false;
  controls.touches.TWO = THREE.TOUCH.PAN;
  controls.minDistance = 0.05;
  controls.maxDistance = 1600;
  controls.autoRotateSpeed = 0.16;
  const ids = new Map(g.knoten.map((k, i) => [k.id, i]));
  const points = g.knoten.map((_, i) =>
    new THREE.Vector3().fromArray(r.positionen, i * 3),
  );
  const colors = g.knoten.map(
    (k, i) =>
      new THREE.Color(
        k.art === "identitaet" ? "#e8f2ff" : BEREICHE[r.regionen[i]].farbe,
      ),
  );
  const bounds = new THREE.Box3().setFromPoints(points);
  const center = g.knoten.length
    ? bounds.getCenter(new THREE.Vector3())
    : new THREE.Vector3();
  const radius = Math.max(25, ...points.map((p) => p.distanceTo(center))) + 14;
  const resources: (THREE.BufferGeometry | THREE.Material)[] = [];
  const makeGeo = (
    positions: number[] | Float32Array,
    tint: number[],
    alpha: Float32Array,
  ) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geo.setAttribute("tint", new THREE.Float32BufferAttribute(tint, 3));
    geo.setAttribute(
      "alpha",
      new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage),
    );
    resources.push(geo);
    return geo;
  };
  const material = (
    vertexShader: string,
    fragmentShader: string,
    uniforms: Record<string, THREE.IUniform> = {},
  ) => {
    const m = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    resources.push(m);
    return m;
  };
  const tint = colors.flatMap((c) => [c.r, c.g, c.b]);
  const nodeAlpha = new Float32Array(points.length).fill(1);
  // Instanced billboards avoid the hardware point-size limit during close flight.
  const quad = new THREE.PlaneGeometry(1, 1);
  const nodeGeo = new THREE.InstancedBufferGeometry();
  nodeGeo.index = quad.index;
  nodeGeo.setAttribute("position", quad.attributes.position);
  nodeGeo.setAttribute("uv", quad.attributes.uv);
  nodeGeo.setAttribute(
    "offset",
    new THREE.InstancedBufferAttribute(r.positionen, 3),
  );
  nodeGeo.setAttribute(
    "tint",
    new THREE.InstancedBufferAttribute(new Float32Array(tint), 3),
  );
  nodeGeo.setAttribute(
    "alpha",
    new THREE.InstancedBufferAttribute(nodeAlpha, 1).setUsage(
      THREE.DynamicDrawUsage,
    ),
  );
  nodeGeo.instanceCount = points.length;
  resources.push(nodeGeo);
  quad.dispose();
  const sizes = new Float32Array(
    g.knoten.map((k, i) =>
      k.art === "identitaet"
        ? 13
        : istHub(k.art)
          ? 5.5 + Math.min(3, Math.log2(r.grad[i] + 1))
          : 3 + k.gewicht * 2,
    ),
  );
  nodeGeo.setAttribute("size", new THREE.InstancedBufferAttribute(sizes, 1));
  const nodeMat = material(
    `attribute vec3 offset; attribute vec3 tint; attribute float alpha; attribute float size;
    uniform float resolution; varying vec3 vTint; varying float vAlpha; varying vec2 vUv;
    void main(){vec4 mv=modelViewMatrix*vec4(offset,1.);vTint=tint;vUv=uv;
      vAlpha=alpha*smoothstep(.15,2.,-mv.z);
      float diameter=max(size*1.3,2.*max(0.,-mv.z)/resolution);
      mv.xy+=position.xy*diameter;gl_Position=projectionMatrix*mv;}`,
    `varying vec3 vTint;varying float vAlpha;varying vec2 vUv;
    void main(){float d=length(vUv-.5)*2.;if(d>1.||vAlpha<.001)discard;
      float halo=exp(-d*d*6.)*.28;
      float core=1.-smoothstep(.03,.22,d);
      float membrane=(1.-smoothstep(.012,.027,abs(d-.3)))*.12;
      gl_FragColor=vec4(mix(vTint,vec3(1.),core*.75),(halo+core*.9+membrane)*vAlpha);}`,
    { resolution: { value: 1000 } },
  );
  const neurons = new THREE.Mesh(nodeGeo, nodeMat);
  neurons.frustumCulled = false;
  neurons.renderOrder = 3;
  scene.add(neurons);

  // Fine dendrites are silhouettes of a node, not additional memories or relations.
  const dendrites: number[] = [],
    dendriteColors: number[] = [],
    owners: number[] = [];
  const addDendrite = (a: THREE.Vector3, b: THREE.Vector3, owner: number) => {
    dendrites.push(...a.toArray(), ...b.toArray());
    const c = colors[owner];
    dendriteColors.push(c.r, c.g, c.b, c.r, c.g, c.b);
    owners.push(owner, owner);
  };
  points.forEach((p, i) => {
    const large = istHub(g.knoten[i].art),
      arms = large ? 7 : 3;
    const length = g.knoten[i].art === "identitaet" ? 14 : large ? 8 : 3.5;
    for (let arm = 0; arm < arms; arm++) {
      const seed = hash(g.knoten[i].id + arm),
        theta = ((seed % 1000) / 1000) * Math.PI * 2;
      const dir = new THREE.Vector3(
        Math.cos(theta),
        Math.sin(theta),
        ((seed >> 12) % 100) / 70 - 0.7,
      ).normalize();
      const side = new THREE.Vector3(-dir.y, dir.x, 0.2).multiplyScalar(
        length * 0.18,
      );
      let last = p;
      for (let s = 1; s <= 4; s++) {
        const t = s / 4,
          next = p
            .clone()
            .addScaledVector(dir, length * t)
            .addScaledVector(side, Math.sin(t * 3));
        addDendrite(last, next, i);
        if (s === 3)
          addDendrite(
            next,
            next
              .clone()
              .addScaledVector(dir, length * 0.25)
              .addScaledVector(side, 1.4),
            i,
          );
        last = next;
      }
    }
  });
  const dendriteAlpha = new Float32Array(owners.length);
  const dendriteGeo = makeGeo(dendrites, dendriteColors, dendriteAlpha);
  scene.add(new THREE.LineSegments(dendriteGeo, material(VERTEX, FRAGMENT)));

  // Cubic fiber bundles preserve each relation's endpoints. Cross-region paths
  // share a corridor; local paths stay near their cluster instead of crossing the core.
  const segments = 16,
    verticesPerEdge = segments * 2;
  const fibers: number[] = [],
    fiberColors: number[] = [],
    along: number[] = [];
  const edgePairs = g.kanten.map((e) => [ids.get(e.von)!, ids.get(e.nach)!]);
  edgePairs.forEach(([a, b], ei) => {
    const pa = points[a],
      pb = points[b],
      distance = pa.distanceTo(pb);
    const ca = new THREE.Vector3(...BEREICHE[r.regionen[a]].mitte),
      cb = new THREE.Vector3(...BEREICHE[r.regionen[b]].mitte);
    const cross = r.regionen[a] !== r.regionen[b];
    const bend = new THREE.Vector3(
      0,
      Math.min(18, distance * 0.12),
      (hash(g.kanten[ei].von + g.kanten[ei].nach) % 20) - 10,
    );
    const c1 = cross
      ? pa.clone().lerp(ca.clone().lerp(cb, 0.36), 0.7)
      : pa.clone().lerp(pb, 0.28).add(bend);
    const c2 = cross
      ? pb.clone().lerp(cb.clone().lerp(ca, 0.36), 0.7)
      : pa.clone().lerp(pb, 0.72).add(bend);
    const curve = new THREE.CubicBezierCurve3(pa, c1, c2, pb);
    for (let s = 0; s < segments; s++)
      for (const t of [s / segments, (s + 1) / segments]) {
        const p = curve.getPoint(t),
          c = colors[a].clone().lerp(colors[b], t);
        fibers.push(p.x, p.y, p.z);
        fiberColors.push(c.r, c.g, c.b);
        along.push(t);
      }
  });
  const fiberAlpha = new Float32Array(along.length),
    trace = new Float32Array(along.length),
    phase = new Float32Array(along.length),
    direction = new Float32Array(along.length);
  const fiberGeo = makeGeo(fibers, fiberColors, fiberAlpha);
  for (const [name, data] of [
    ["along", new Float32Array(along)],
    ["trace", trace],
    ["phase", phase],
    ["direction", direction],
  ] as const)
    fiberGeo.setAttribute(name, new THREE.BufferAttribute(data, 1));
  const fiberMat = material(
    `
    attribute vec3 tint;attribute float alpha;attribute float along;attribute float trace;attribute float phase;attribute float direction;
    varying vec3 vTint;varying float vAlpha;varying float vAlong;varying float vTrace;varying float vPhase;
    void main(){vTint=tint;vAlpha=alpha;vAlong=mix(along,1.-along,direction);vTrace=trace;vPhase=phase;
      gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}
  `,
    `
    uniform float time;uniform float animate;
    varying vec3 vTint;varying float vAlpha;varying float vAlong;varying float vTrace;varying float vPhase;
    void main(){if(vAlpha<.001)discard;float travel=mod(time,5.)-vPhase*.75;
      float head=exp(-pow((vAlong-travel)/.1,2.))*vTrace*animate;
      gl_FragColor=vec4(mix(vTint,vec3(.88,.96,1.),head*.8),min(.95,vAlpha+head*.85));}
  `,
    { time: { value: 0 }, animate: { value: 0 } },
  );
  scene.add(new THREE.LineSegments(fiberGeo, fiberMat));

  // Labels remain native buttons, including on touch and with a keyboard.
  const pool = Array.from({ length: narrow ? 5 : 9 }, () => {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "gehirn-label";
    el.hidden = true;
    el.addEventListener("click", () => {
      if (el.dataset.id) waehle(el.dataset.id);
    });
    labels.appendChild(el);
    return el;
  });
  const labelIndices = g.knoten
    .map((_, i) => i)
    .sort((a, b) => {
      const score = (i: number) =>
        (g.knoten[i].art === "identitaet"
          ? 10000
          : istHub(g.knoten[i].art)
            ? 200
            : 0) + r.grad[i];
      return score(b) - score(a);
    })
    .slice(0, 90);
  const projected = new THREE.Vector3();
  let state: Ansicht = {
    sichtbar: new Set(g.knoten.map((k) => k.id)),
    umfeld: new Map(),
    treffer: null,
    auswahl: null,
    bewegung: true,
  };
  let dirty = true;
  let overview = true,
    disposed = false,
    contextLost = false,
    intersecting = true,
    interacted = false;
  let flight: { target: THREE.Vector3; position: THREE.Vector3 } | null = null;
  let lastTime = 0,
    elapsed = 0,
    frames = 0,
    slowFrames = 0,
    lastLabels = 0;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const distanceToFit = (extent = radius) =>
    (extent /
      Math.sin(
        Math.min(
          THREE.MathUtils.degToRad(camera.fov),
          2 *
            Math.atan(
              Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) *
                camera.aspect,
            ),
        ) / 2,
      )) *
    1.08;
  const home = () => {
    const visiblePoints = points.filter((_, i) =>
      state.sichtbar.has(g.knoten[i].id),
    );
    const target = visiblePoints.length
      ? new THREE.Box3()
          .setFromPoints(visiblePoints)
          .getCenter(new THREE.Vector3())
      : center.clone();
    const extent =
      Math.max(25, ...visiblePoints.map((p) => p.distanceTo(target))) + 14;
    const position = target
      .clone()
      .add(
        new THREE.Vector3(0.14, 0.08, 1)
          .normalize()
          .multiplyScalar(distanceToFit(extent)),
      );
    if (reduced.matches) {
      controls.target.copy(target);
      camera.position.copy(position);
      controls.update();
      flight = null;
    } else flight = { target, position };
  };
  const resize = () => {
    dirty = true;
    const w = Math.max(1, box.clientWidth),
      h = Math.max(1, box.clientHeight);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    nodeMat.uniforms.resolution.value = h * pixelRatio * 1.6;
    if (overview) home();
  };
  const update = (a: Ansicht) => {
    const changedSelection = a.auswahl !== state.auswahl;
    if (a.bewegung && !state.bewegung && !a.auswahl) interacted = false;
    dirty = true;
    state = a;
    if (changedSelection) elapsed = 0;
    g.knoten.forEach((k, i) => {
      const visible = a.sichtbar.has(k.id),
        related = !a.auswahl || a.umfeld.has(k.id),
        found = !a.treffer || a.treffer.has(k.id);
      nodeAlpha[i] = !visible
        ? 0
        : !related || !found
          ? 0.22
          : a.auswahl === k.id
            ? 1.5
            : 0.95;
    });
    owners.forEach((owner, i) => {
      dendriteAlpha[i] = nodeAlpha[owner] * 0.24;
    });
    g.kanten.forEach((e, i) => {
      const da = state.umfeld.get(e.von),
        db = state.umfeld.get(e.nach);
      const shown = state.sichtbar.has(e.von) && state.sichtbar.has(e.nach);
      const active =
        state.auswahl !== null && da !== undefined && db !== undefined;
      const matches =
        !state.treffer || state.treffer.has(e.von) || state.treffer.has(e.nach);
      const alpha = !shown
        ? 0
        : !matches
          ? 0.004
          : state.auswahl
            ? active
              ? 0.4
              : 0.008
            : 0.075 + e.gewicht * 0.13;
      for (let j = 0; j < verticesPerEdge; j++) {
        const v = i * verticesPerEdge + j;
        fiberAlpha[v] = alpha;
        trace[v] = active && da !== db && matches ? 1 : 0;
        phase[v] = Math.min(da ?? 0, db ?? 0);
        direction[v] = (da ?? 0) > (db ?? 0) ? 1 : 0;
      }
    });
    nodeGeo.attributes.alpha.needsUpdate = true;
    dendriteGeo.attributes.alpha.needsUpdate = true;
    for (const key of ["alpha", "trace", "phase", "direction"])
      fiberGeo.attributes[key].needsUpdate = true;
    controls.autoRotate =
      a.bewegung && !reduced.matches && !interacted && !a.auswahl;
    fiberMat.uniforms.animate.value = a.bewegung && !reduced.matches ? 1 : 0;
  };
  const drawLabels = () => {
    const selected = state.auswahl ? ids.get(state.auswahl) : undefined;
    const nearby = points
      .map((p, i) => ({ i, d: p.distanceToSquared(camera.position) }))
      .sort((a, b) => a.d - b.d);
    const local =
      nearby[0]?.d < radius * radius ? nearby.map((p) => p.i) : labelIndices;
    const candidates =
      selected === undefined
        ? local
        : [selected, ...local.filter((i) => i !== selected)];
    const rects: number[][] = [];
    let count = 0;
    for (const i of candidates) {
      if (count >= pool.length) break;
      const k = g.knoten[i];
      if (
        !state.sichtbar.has(k.id) ||
        (state.auswahl && !state.umfeld.has(k.id)) ||
        (state.treffer && !state.treffer.has(k.id))
      )
        continue;
      projected.copy(points[i]).project(camera);
      if (projected.z < -1 || projected.z > 1) continue;
      const x = (projected.x * 0.5 + 0.5) * box.clientWidth + 8,
        y = (-projected.y * 0.5 + 0.5) * box.clientHeight;
      const width = Math.min(168, k.titel.length * 6.5 + 18),
        height = narrow ? 44 : 32;
      if (
        x < 8 ||
        x + width > box.clientWidth - 8 ||
        y < 18 ||
        y > box.clientHeight - 26
      )
        continue;
      if (
        rects.some(
          ([rx, ry, rw]) =>
            x < rx + rw + 8 && x + width + 8 > rx && Math.abs(y - ry) < height,
        )
      )
        continue;
      rects.push([x, y, width]);
      const el = pool[count++];
      el.hidden = false;
      el.textContent = k.titel;
      el.dataset.id = k.id;
      el.setAttribute("aria-label", `${k.titel} ansehen`);
      el.style.transform = `translate(${Math.round(x)}px,${Math.round(y - 14)}px)`;
      el.style.setProperty("--neuron-color", colors[i].getStyle());
      el.classList.toggle("is-selected", state.auswahl === k.id);
    }
    for (; count < pool.length; count++) pool[count].hidden = true;
  };
  const render = (time: number) => {
    if (disposed || contextLost) return;
    const dt = Math.min(0.05, lastTime ? (time - lastTime) / 1000 : 0.016);
    lastTime = time;
    if (state.bewegung && !reduced.matches) elapsed += dt;
    fiberMat.uniforms.time.value = elapsed;
    if (flight) {
      const t = reduced.matches ? 1 : 1 - Math.exp(-dt * 7);
      controls.target.lerp(flight.target, t);
      camera.position.lerp(flight.position, t);
      if (camera.position.distanceTo(flight.position) < 0.1) {
        controls.target.copy(flight.target);
        camera.position.copy(flight.position);
        flight = null;
      }
    }
    const cameraChanged = controls.update(dt);
    const animateTrace =
      state.bewegung && !reduced.matches && state.auswahl !== null;
    if (dirty || cameraChanged || animateTrace || flight)
      renderer.render(scene, camera);
    if (dirty || ((cameraChanged || flight) && time - lastLabels > 100)) {
      drawLabels();
      lastLabels = time;
    }
    dirty = false;
    // Quality adapts only downward during a visit; it cannot oscillate or rebuild the graph.
    if (dt > 0.03) slowFrames++;
    if (++frames === 180 && slowFrames > 90 && pixelRatio > 1) {
      pixelRatio = 1;
      renderer.setPixelRatio(1);
      resize();
    }
  };
  const run = () => {
    lastTime = 0;
    renderer.setAnimationLoop(
      !disposed && !contextLost && !document.hidden && intersecting
        ? render
        : null,
    );
  };
  let start: { x: number; y: number; id: number } | null = null;
  const pointers = new Set<number>();
  const touches = new Map<number, { x: number; y: number }>();
  const travel = (factor: number) => {
    if (!Number.isFinite(factor) || factor <= 0) return;
    flight = null;
    overview = false;
    interacted = true;
    controls.autoRotate = false;
    let nearest = radius;
    points.forEach((p, i) => {
      if (state.sichtbar.has(g.knoten[i].id))
        nearest = Math.min(nearest, p.distanceTo(camera.position));
    });
    const step =
      THREE.MathUtils.clamp(nearest, 12, radius * 2) *
      THREE.MathUtils.clamp(-Math.log(factor), -0.5, 0.5);
    const direction = camera.getWorldDirection(new THREE.Vector3());
    const destination = camera.position
      .clone()
      .addScaledVector(direction, step);
    // The real graph is finite; always permit the way back from its outer boundary.
    if (
      destination.distanceTo(center) > radius * 10 &&
      destination.distanceTo(center) > camera.position.distanceTo(center)
    )
      return;
    camera.position.copy(destination);
    controls.target.copy(destination).addScaledVector(direction, 20);
    dirty = true;
  };
  const move = (e: PointerEvent) => {
    if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 7)
      start = null;
    if (!touches.has(e.pointerId)) return;
    const before = [...touches.values()];
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size !== 2) return;
    const after = [...touches.values()];
    const a = Math.hypot(before[0].x - before[1].x, before[0].y - before[1].y);
    const b = Math.hypot(after[0].x - after[1].x, after[0].y - after[1].y);
    if (a > 8 && b > 8) travel(a / b);
  };
  const down = (e: PointerEvent) => {
    pointers.add(e.pointerId);
    if (e.pointerType === "touch")
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    start =
      pointers.size === 1
        ? { x: e.clientX, y: e.clientY, id: e.pointerId }
        : null;
    flight = null;
    overview = false;
    interacted = true;
    controls.autoRotate = false;
  };
  const cancel = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    touches.delete(e.pointerId);
    start = null;
  };
  const up = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    touches.delete(e.pointerId);
    const s = start;
    start = null;
    if (
      !s ||
      s.id !== e.pointerId ||
      Math.hypot(e.clientX - s.x, e.clientY - s.y) > 7
    )
      return;
    const rect = box.getBoundingClientRect(),
      x = e.clientX - rect.left,
      y = e.clientY - rect.top;
    let best: string | null = null,
      distance = e.pointerType === "touch" ? 26 : 15;
    points.forEach((p, i) => {
      if (!state.sichtbar.has(g.knoten[i].id) || nodeAlpha[i] < 0.1) return;
      projected.copy(p).project(camera);
      if (projected.z < -1 || projected.z > 1) return;
      const d = Math.hypot(
        (projected.x * 0.5 + 0.5) * rect.width - x,
        (-projected.y * 0.5 + 0.5) * rect.height - y,
      );
      if (d < distance) {
        distance = d;
        best = g.knoten[i].id;
      }
    });
    waehle(best);
  };
  const wheel = (e: WheelEvent) => {
    e.preventDefault();
    const units =
      e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? box.clientHeight : 1;
    travel(
      Math.exp(THREE.MathUtils.clamp(e.deltaY * units * 0.002, -0.5, 0.5)),
    );
  };
  const lost = (e: Event) => {
    e.preventDefault();
    contextLost = true;
    run();
    fehler(
      "Die 3D-Ansicht wurde vom Gerät pausiert. Die Einträge bleiben in der Liste erreichbar.",
    );
  };
  renderer.domElement.addEventListener("pointerdown", down);
  renderer.domElement.addEventListener("pointermove", move);
  renderer.domElement.addEventListener("pointerup", up);
  renderer.domElement.addEventListener("pointercancel", cancel);
  renderer.domElement.addEventListener("wheel", wheel, { passive: false });
  renderer.domElement.addEventListener("webglcontextlost", lost);
  document.addEventListener("visibilitychange", run);
  const motionChange = () => {
    update(state);
    if (reduced.matches && flight) {
      camera.position.copy(flight.position);
      controls.target.copy(flight.target);
      flight = null;
    }
  };
  reduced.addEventListener("change", motionChange);
  const observer = new ResizeObserver(resize);
  observer.observe(box);
  const intersection =
    typeof IntersectionObserver !== "undefined"
      ? new IntersectionObserver((entries) => {
          intersecting = entries[0]?.isIntersecting ?? true;
          run();
        })
      : null;
  intersection?.observe(box);
  resize();
  camera.position
    .copy(center)
    .add(
      new THREE.Vector3(0.14, 0.08, 1)
        .normalize()
        .multiplyScalar(distanceToFit()),
    );
  controls.target.copy(center);
  flight = null;
  update(state);
  run();
  return {
    update,
    fokus(id) {
      if (id === null) {
        overview = true;
        interacted = false;
        home();
        update(state);
        return;
      }
      const i = ids.get(id);
      if (i === undefined) return;
      overview = false;
      interacted = true;
      controls.autoRotate = false;
      const target = points[i].clone();
      const neighbors = points.filter((_, j) =>
        state.umfeld.has(g.knoten[j].id),
      );
      const extent = Math.max(
        30,
        ...neighbors.map((p) => p.distanceTo(target)),
      );
      const angle = Math.min(
        THREE.MathUtils.degToRad(camera.fov),
        2 *
          Math.atan(
            Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect,
          ),
      );
      const position = target.clone().add(
        camera.position
          .clone()
          .sub(controls.target)
          .normalize()
          .multiplyScalar(
            Math.min(distanceToFit(), (extent / Math.sin(angle / 2)) * 0.85),
          ),
      );
      flight = { target, position };
      if (reduced.matches) {
        camera.position.copy(position);
        controls.target.copy(target);
        flight = null;
      }
    },
    zoom: travel,
    eintauchen(id) {
      const i = ids.get(id);
      if (i === undefined) return;
      overview = false;
      interacted = true;
      controls.autoRotate = false;
      const direction = points[i].clone().sub(camera.position).normalize();
      const target = points[i].clone();
      const position = target.clone().addScaledVector(direction, -12);
      if (reduced.matches) {
        camera.position.copy(position);
        controls.target.copy(target);
        dirty = true;
      } else flight = { target, position };
    },
    dispose() {
      disposed = true;
      renderer.setAnimationLoop(null);
      observer.disconnect();
      intersection?.disconnect();
      document.removeEventListener("visibilitychange", run);
      reduced.removeEventListener("change", motionChange);
      renderer.domElement.removeEventListener("pointerdown", down);
      renderer.domElement.removeEventListener("pointermove", move);
      renderer.domElement.removeEventListener("pointerup", up);
      renderer.domElement.removeEventListener("pointercancel", cancel);
      renderer.domElement.removeEventListener("wheel", wheel);
      renderer.domElement.removeEventListener("webglcontextlost", lost);
      controls.dispose();
      resources.forEach((x) => x.dispose());
      renderer.dispose();
      renderer.domElement.remove();
      pool.forEach((x) => x.remove());
    },
  };
}
