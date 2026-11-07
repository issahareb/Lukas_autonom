export type ChatHandoff = { id: string; content: string; mode: 'send' | 'draft'; conversationId?: number; attempted?: boolean };
const HANDOFF = 'lukas_chat_handoff';
let fallback: ChatHandoff | null = null;
const get = (key: string) => { try { return sessionStorage.getItem(key); } catch { return null; } };
const put = (key: string, value: string | null) => { try { value === null ? sessionStorage.removeItem(key) : sessionStorage.setItem(key, value); } catch { /* In-memory handoff still works when storage is unavailable. */ } };
export function queueChat(content: string, mode: ChatHandoff['mode']): ChatHandoff {
  const item = { id: crypto.randomUUID(), content, mode };
  saveHandoff(item); return item;
}
export function saveHandoff(item: ChatHandoff) { fallback = item; put(HANDOFF, JSON.stringify(item)); }
export function readHandoff(): ChatHandoff | null {
  try {
    const raw = get(HANDOFF);
    if (raw) {
      const value = JSON.parse(raw);
      if (typeof value.id === 'string' && typeof value.content === 'string' && ['send','draft'].includes(value.mode)) return value;
    }
  } catch { /* A damaged stored draft must not crash navigation. */ }
  const legacy = get('lukas_startfrage');
  if (legacy) { const value = queueChat(legacy, 'send'); put('lukas_startfrage', null); return value; }
  return fallback;
}
export function clearHandoff(id: string) { if (readHandoff()?.id === id) { fallback = null; put(HANDOFF, null); } }
export const readDraft = (id: number | null) => id ? get(`lukas_draft_${id}`) ?? '' : '';
export const saveDraft = (id: number | null, value: string) => { if (id) put(`lukas_draft_${id}`, value || null); };
export function lastChat(): number | null { const id = Number(get('lukas_active_chat')); return Number.isSafeInteger(id) && id > 0 ? id : null; }
export const rememberChat = (id: number | null) => put('lukas_active_chat', id ? String(id) : null);
export const readHomeDraft = () => get('lukas_home_draft') ?? '';
export const saveHomeDraft = (value: string) => put('lukas_home_draft', value || null);
