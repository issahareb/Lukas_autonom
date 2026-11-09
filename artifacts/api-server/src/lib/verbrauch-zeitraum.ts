const TAG = 86_400_000;
function datum(value: unknown): Date {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError('Datum als YYYY-MM-DD angeben.');
  const d = new Date(value + 'T00:00:00.000Z');
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0,10) !== value) throw new RangeError('Ungültiges Kalenderdatum.');
  return d;
}
export type ZeitraumInput = { von?: unknown; bis?: unknown; vergleichVon?: unknown; vergleichBis?: unknown };
export function verbrauchsZeitraum(input: ZeitraumInput = {}, jetzt = new Date()) {
  const heute = jetzt.toISOString().slice(0,10);
  if ((input.von === undefined) !== (input.bis === undefined)) throw new RangeError('von und bis gemeinsam angeben.');
  // Default: seven completed UTC days, then the seven immediately before them.
  const ende = input.bis === undefined ? new Date(datum(heute).getTime() - TAG) : datum(input.bis);
  const anfang = input.von === undefined ? new Date(ende.getTime() - 6 * TAG) : datum(input.von);
  const tage = (ende.getTime() - anfang.getTime()) / TAG + 1;
  if (tage < 1 || tage > 90 || ende.getTime() > datum(heute).getTime()) throw new RangeError('Zeitraum muss 1 bis 90 Tage umfassen und darf nicht in der Zukunft liegen.');
  const bisExklusiv = new Date(ende.getTime() + TAG);
  if ((input.vergleichVon === undefined) !== (input.vergleichBis === undefined)) throw new RangeError('vergleichVon und vergleichBis gemeinsam angeben.');
  const altVon = input.vergleichVon === undefined ? new Date(anfang.getTime()-tage*TAG) : datum(input.vergleichVon);
  const altBis = input.vergleichBis === undefined ? new Date(anfang.getTime()-TAG) : datum(input.vergleichBis);
  if ((altBis.getTime()-altVon.getTime())/TAG+1 !== tage || altBis >= anfang || (anfang.getTime()-altVon.getTime())/TAG>180) {
    throw new RangeError('Vergleichsfenster muss gleich lang sein, vor dem aktuellen Fenster liegen und höchstens 180 Tage zurückreichen.');
  }
  return { von: anfang.toISOString().slice(0,10), bis: ende.toISOString().slice(0,10), tage, seit: anfang, bisExklusiv,
    vergleichVon: altVon.toISOString().slice(0,10),
    vergleichBis: altBis.toISOString().slice(0,10),
    vollstaendig: bisExklusiv.getTime() <= datum(heute).getTime(), zeitzone: 'UTC' as const };
}
