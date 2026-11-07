import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ToolStep } from './tool-steps';
export type Rueckfrage = { surface: 'lukas-rueckfrage'; id: string; conversationId: number; fragen: { frage: string; optionen?: string[] }[] };
export function rueckfrageAus(steps: ToolStep[], conversationId: number | null): Rueckfrage | null {
  for (const step of [...steps].reverse()) {
    if (!step.ok || !['frage_issa','mcp_call'].includes(step.tool)) continue;
    try {
      const r = JSON.parse(step.result);
      if (r.surface !== 'lukas-rueckfrage' || typeof r.id !== 'string' || r.conversationId !== conversationId || !Array.isArray(r.fragen) || r.fragen.length < 1 || r.fragen.length > 3) continue;
      if (!r.fragen.every((f: Rueckfrage['fragen'][number]) => typeof f.frage === 'string' && f.frage.length <= 500 && (!f.optionen || Array.isArray(f.optionen) && f.optionen.length <= 4 && f.optionen.every(o => typeof o === 'string' && o.length <= 160)))) continue;
      return r;
    } catch { /* Ordinary tool output is never treated as a question. */ }
  }
  return null;
}
export function RueckfrageFenster({ frage, busy, antworten }: { frage: Rueckfrage; busy: boolean; antworten: (text: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(true);
  const [answers, setAnswers] = useState<string[]>(() => {
    try { const saved = JSON.parse(sessionStorage.getItem(`lukas_question_${frage.id}`) ?? 'null'); if (Array.isArray(saved) && saved.length === frage.fragen.length && saved.every(x => typeof x === 'string')) return saved; } catch { /* Keep a usable form. */ }
    return frage.fragen.map(() => '');
  });
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  useEffect(() => { try { sessionStorage.setItem(`lukas_question_${frage.id}`, JSON.stringify(answers)); } catch {} }, [answers, frage.id]);
  const change = (i: number, text: string) => setAnswers(a => a.map((value, j) => i === j ? text : value));
  return <>
    <button type="button" className="rounded-full border px-4 py-2 text-sm" onClick={() => setOpen(true)}>Rückfrage beantworten</button>
    <Dialog.Root open={open} onOpenChange={setOpen}>
      {open && <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-[80] bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[81] max-h-[85dvh] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-3xl border bg-background p-6 text-foreground shadow-xl">
          <Dialog.Title className="pr-8 text-xl font-semibold">Lukas hat eine Rückfrage</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-muted-foreground">Deine Antwort gehört zu diesem Gespräch. Du kannst eine Option wählen oder selbst antworten.</Dialog.Description>
          <Dialog.Close aria-label="Rückfrage später beantworten" className="absolute right-5 top-5 p-1"><X size={20} /></Dialog.Close>
          <form className="mt-5 space-y-5" onSubmit={async e => {
            e.preventDefault(); if (busy || sending || answers.some(a => !a.trim())) return;
            setSending(true); setError('');
            try {
              const text = `Antwort auf deine Rückfrage [${frage.id}]:\n` + answers.map((answer, i) => `${i + 1}. Antwort: ${answer.trim()}`).join('\n');
              if (await antworten(text)) { try { sessionStorage.removeItem(`lukas_question_${frage.id}`); } catch {} setOpen(false); }
              else setError('Die Antwort konnte nicht bestätigt werden. Deine Eingabe bleibt erhalten.');
            } catch { setError('Senden fehlgeschlagen. Deine Eingabe bleibt erhalten.'); }
            finally { setSending(false); }
          }}>
            {frage.fragen.map((f, i) => <fieldset key={i} className="space-y-2" disabled={busy || sending}>
              <legend className="mb-2 font-medium">{f.frage}</legend>
              {f.optionen?.map((o, j) => <label key={j} className="flex cursor-pointer items-start gap-2 rounded-xl border p-3 text-sm"><input type="radio" name={`question-${frage.id}-${i}`} checked={answers[i] === o} onChange={() => change(i,o)} /><span>{o}</span></label>)}
              <label className="block text-sm">Deine Antwort<textarea aria-label={`Antwort auf ${f.frage}`} className="mt-1 min-h-20 w-full rounded-xl border bg-background p-3" maxLength={5000} value={answers[i]} onChange={e => change(i,e.target.value)} /></label>
            </fieldset>)}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-end gap-3"><button type="button" className="rounded-full border px-4 py-2" onClick={() => setOpen(false)}>Später</button><button type="submit" className="rounded-full bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50" disabled={busy || sending || answers.some(a => !a.trim())}>{sending ? 'Wird gesendet …' : 'Antwort senden'}</button></div>
          </form>
        </Dialog.Content></Dialog.Portal>}
    </Dialog.Root>
  </>;
}
