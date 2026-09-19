import { afterEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { neuronSteuerung } from "./steuerung";

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((fn) => fn()));
function setup(invertiert = true) {
  const canvas = document.createElement("canvas");
  Object.defineProperties(canvas, {
    clientWidth: { value: 390 },
    clientHeight: { value: 600 },
  });
  canvas.setPointerCapture = () => {};
  canvas.releasePointerCapture = () => {};
  document.body.appendChild(canvas);
  const camera = new THREE.PerspectiveCamera(44, 390 / 600, 0.1, 5000);
  camera.position.set(0, 0, 100);
  const controls = neuronSteuerung(camera, canvas, invertiert);
  cleanups.push(() => {
    controls.dispose();
    canvas.remove();
  });
  function pointer(type: string, id: number, x: number, y: number) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, {
      pointerId: id,
      pointerType: "touch",
      clientX: x,
      clientY: y,
      pageX: x,
      pageY: y,
      button: 0,
    });
    canvas.dispatchEvent(event);
  }
  function settle() {
    for (let i = 0; i < 90; i++) controls.update(1 / 60);
    camera.updateMatrixWorld();
  }
  function pinch() {
    pointer("pointerdown", 1, 145, 300);
    pointer("pointerdown", 2, 245, 300);
    for (let d = 5; d <= 40; d += 5) {
      pointer("pointermove", 1, 145 - d, 300);
      pointer("pointermove", 2, 245 + d, 300);
    }
    pointer("pointerup", 1, 105, 300);
    pointer("pointerup", 2, 285, 300);
    settle();
  }
  return { camera, controls, pointer, settle, pinch };
}

describe("Mobile Neuronensteuerung mit echten OrbitControls", () => {
  it("kehrt auch die vertikale Achse um und lässt sich auf die normale Richtung stellen", () => {
    const inverted = setup();
    inverted.pointer("pointerdown", 1, 180, 250);
    inverted.pointer("pointermove", 1, 180, 350);
    inverted.pointer("pointerup", 1, 180, 350);
    inverted.settle();
    expect(inverted.camera.position.y).toBeLessThan(-5);
    const normal = setup(false);
    normal.pointer("pointerdown", 2, 100, 250);
    normal.pointer("pointermove", 2, 200, 350);
    normal.pointer("pointerup", 2, 200, 350);
    normal.settle();
    expect(normal.camera.position.x).toBeLessThan(-5);
    expect(normal.camera.position.y).toBeGreaterThan(5);
  });
  it("kehrt die Drehachse um und dreht langsam um das Zentrum", () => {
    const { camera, controls, pointer, settle } = setup();
    pointer("pointerdown", 1, 120, 300);
    pointer("pointermove", 1, 220, 300);
    pointer("pointerup", 1, 220, 300);
    settle();
    const front = new THREE.Vector3(0, 0, 20).project(camera);
    expect(front.x).toBeLessThan(0);
    expect(camera.position.length()).toBeCloseTo(100);
    expect(controls.target.length()).toBe(0);
    const angle = Math.abs(Math.atan2(camera.position.x, camera.position.z));
    expect(angle).toBeGreaterThan(0.1);
    expect(angle).toBeLessThan(0.25);
  });
  it("zoomt mit einer symmetrischen Pinch-Geste ohne den Drehpunkt zu verlegen", () => {
    const { camera, controls, pinch } = setup();
    pinch();
    expect(camera.position.length()).toBeLessThan(100);
    expect(camera.position.length()).toBeGreaterThan(60);
    expect(controls.target.length()).toBeLessThan(1);
  });
  it("kann nach dem Zoomen weiter um denselben Drehpunkt rotieren", () => {
    const { camera, controls, pointer, settle, pinch } = setup();
    pinch();
    const target = controls.target.clone();
    const distance = camera.position.distanceTo(target);
    pointer("pointerdown", 3, 120, 300);
    pointer("pointermove", 3, 180, 300);
    pointer("pointerup", 3, 180, 300);
    settle();
    expect(controls.target.distanceTo(target)).toBeLessThan(0.001);
    expect(camera.position.distanceTo(target)).toBeCloseTo(distance);
    expect(camera.position.x).toBeGreaterThan(5);
  });
  it("verschiebt mit zwei Fingern, ohne die Entfernung zu verändern", () => {
    const { camera, controls, pointer, settle } = setup();
    pointer("pointerdown", 1, 145, 300);
    pointer("pointerdown", 2, 245, 300);
    for (let d = 5; d <= 40; d += 5) {
      pointer("pointermove", 1, 145 + d, 300);
      pointer("pointermove", 2, 245 + d, 300);
    }
    pointer("pointerup", 1, 185, 300);
    pointer("pointerup", 2, 285, 300);
    settle();
    expect(Math.abs(controls.target.x)).toBeGreaterThan(1);
    expect(camera.position.distanceTo(controls.target)).toBeCloseTo(100);
  });
});
