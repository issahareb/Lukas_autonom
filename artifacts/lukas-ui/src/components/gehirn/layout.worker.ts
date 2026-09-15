import { lege, type Gehirn } from "./modell";

self.onmessage = (e: MessageEvent<Gehirn>) => {
  try {
    const raum = lege(e.data);
    self.postMessage(
      { raum },
      {
        transfer: [
          raum.positionen.buffer,
          raum.regionen.buffer,
          raum.grad.buffer,
        ],
      },
    );
  } catch {
    self.postMessage({
      fehler: "Die räumliche Ansicht konnte nicht berechnet werden.",
    });
  }
};
