import { StrictMode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearHandoff, queueChat, readHandoff } from '@/lib/chat-draft';
const state = vi.hoisted(() => ({ messages: [] as unknown[], create: vi.fn(), invalidate: vi.fn() }));
vi.mock('@workspace/api-client-react', () => ({
  useListAnthropicConversations: () => ({data:[{id:51,title:'Erstes Gespräch',createdAt:'2026-11-07T12:00:00Z'},{id:52,title:'Zweites Gespräch',createdAt:'2026-11-07T13:00:00Z'}]}),
  useGetAnthropicConversation: (id: number) => ({data:id?{id,title:'Gespräch',messages:state.messages}:undefined}),
  useCreateAnthropicConversation: () => ({mutateAsync:state.create,isPending:false}),
  useDeleteAnthropicConversation: () => ({mutateAsync:vi.fn()}),
  getListAnthropicConversationsQueryKey: () => ['conversations'],
  getGetAnthropicConversationQueryKey: (id: number) => ['conversations',id],
}));
vi.mock('@tanstack/react-query', () => ({useQueryClient:()=>({invalidateQueries:state.invalidate})}));
vi.mock('@/hooks/use-mobile',()=>({useIsMobile:()=>true}));
vi.mock('@/hooks/use-sprachsitzung',()=>({useSprachsitzung:()=>({aktiv:false,status:'aus',zeilen:[],starten:vi.fn(),beenden:vi.fn()})}));
vi.mock('@/components/lukas-avatar',()=>({LukasAvatar:()=>null}));
import Chat from './chat';
let sent: {url:string;content:string}[];
beforeEach(()=>{
  const prior=readHandoff();if(prior)clearHandoff(prior.id);
  sessionStorage.clear();state.messages=[];state.create.mockReset().mockResolvedValue({id:55});state.invalidate.mockReset();sent=[];
  vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{
    if(String(url).endsWith('/messages')){
      sent.push({url:String(url),content:JSON.parse(String(init?.body)).content});
      state.messages=[...state.messages,{id:1,role:'user',content:sent.at(-1)!.content,createdAt:new Date().toISOString()},{id:2,role:'assistant',content:'Erledigt',createdAt:new Date().toISOString()}];
      return new Response('data: {"content":"Erledigt"}\n\ndata: {"done":true}\n\n',{headers:{'Content-Type':'text/event-stream'}});
    }
    return Response.json([]);
  }));
  HTMLElement.prototype.scrollTo=vi.fn();
});
describe('Echte Chatseite: Navigation und Eingaben',()=>{
  it('öffnet aus der Hero-Eingabe einen neuen Chat und sendet genau einmal, auch unter StrictMode',async()=>{
    queueChat('Meine unveränderte Hero-Anfrage','send');
    render(<StrictMode><Chat/></StrictMode>);
    await waitFor(()=>expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({url:'/api/anthropic/conversations/55/messages',content:'Meine unveränderte Hero-Anfrage'});
    expect(state.create).toHaveBeenCalledTimes(1);
    await waitFor(()=>expect(readHandoff()).toBeNull());
    expect(screen.getByRole('textbox',{name:'Nachricht an Lukas'})).toBeVisible();
  });
  it('erhält die Hero-Eingabe bei gescheiterter Gesprächserstellung',async()=>{
    queueChat('Diesen Text nicht verlieren','send');state.create.mockRejectedValue(new Error('offline'));
    render(<Chat/>);await screen.findByRole('alert');
    expect(readHandoff()?.content).toBe('Diesen Text nicht verlieren');expect(sent).toHaveLength(0);
  });
  it('öffnet den Anhang-Einstieg als neuen Chatentwurf ohne ungefragtes Senden',async()=>{
    queueChat('Text zur Datei','draft');render(<Chat/>);
    expect(await screen.findByRole('textbox',{name:'Nachricht an Lukas'})).toHaveValue('Text zur Datei');
    expect(sent).toHaveLength(0);
  });
  it('erhält getrennte Entwürfe beim Gesprächswechsel',async()=>{
    const user=userEvent.setup();render(<Chat/>);
    await user.click(screen.getByRole('button',{name:/^Erstes Gespräch\s*Begonnen/}));
    await user.type(screen.getByRole('textbox',{name:'Nachricht an Lukas'}),'Entwurf eins');
    await user.click(screen.getByRole('button',{name:'Zurück zur Liste'}));
    await user.click(screen.getByRole('button',{name:/^Zweites Gespräch\s*Begonnen/}));
    expect(screen.getByRole('textbox',{name:'Nachricht an Lukas'})).toHaveValue('');
    await user.type(screen.getByRole('textbox',{name:'Nachricht an Lukas'}),'Entwurf zwei');
    await user.click(screen.getByRole('button',{name:'Zurück zur Liste'}));
    await user.click(screen.getByRole('button',{name:/^Erstes Gespräch\s*Begonnen/}));
    expect(screen.getByRole('textbox',{name:'Nachricht an Lukas'})).toHaveValue('Entwurf eins');
  });
  it('stellt einen abgewiesenen Text wieder her und sendet nach erneutem Mounten nicht automatisch doppelt',async()=>{
    queueChat('Gesicherte Anfrage','send');vi.stubGlobal('fetch',vi.fn(async(url:string)=>String(url).endsWith('/messages')?Response.json({error:'Testfehler'},{status:503}):Response.json([])));
    const view=render(<Chat/>);
    await waitFor(()=>expect(screen.getByRole('textbox',{name:'Nachricht an Lukas'})).toHaveValue('Gesicherte Anfrage'));
    await screen.findByText('Testfehler');expect(readHandoff()?.attempted).toBe(true);
    const count=vi.mocked(fetch).mock.calls.filter(([url])=>String(url).endsWith('/messages')).length;
    view.unmount();render(<Chat/>);await screen.findByRole('alert');
    expect(vi.mocked(fetch).mock.calls.filter(([url])=>String(url).endsWith('/messages'))).toHaveLength(count);
  });
  it('sendet die strukturierte Rückfrage an das richtige Gespräch',async()=>{
    sessionStorage.setItem('lukas_active_chat','51');
    const result={surface:'lukas-rueckfrage',id:'frage-a',conversationId:51,fragen:[{frage:'Welche Variante möchtest du?',optionen:['Kurz','Ausführlich']}]};
    state.messages=[{id:1,role:'assistant',content:'Welche Variante?',createdAt:new Date().toISOString(),steps:[{tool:'frage_issa',input:'{}',ok:true,result:JSON.stringify(result),ms:1}]}];
    const user=userEvent.setup();render(<Chat/>);
    await screen.findByRole('dialog',{name:'Lukas hat eine Rückfrage'});
    await user.click(screen.getByRole('radio',{name:'Kurz'}));await user.click(screen.getByRole('button',{name:'Antwort senden'}));
    await waitFor(()=>expect(sent).toHaveLength(1));
    expect(sent[0].url).toContain('/51/messages');expect(sent[0].content).toContain('Antwort: Kurz');
  });
  it('bewahrt auch einen normalen Entwurf bis zur HTTP-Bestätigung',async()=>{
    sessionStorage.setItem('lukas_active_chat','51');
    vi.stubGlobal('fetch',vi.fn((url:string,init?:RequestInit)=>String(url).endsWith('/messages')?new Promise((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')))):Promise.resolve(Response.json([]))));
    const user=userEvent.setup(),view=render(<Chat/>);
    await user.type(screen.getByRole('textbox',{name:'Nachricht an Lukas'}),'Noch nicht bestätigt');
    await user.click(screen.getByRole('button',{name:'Senden'}));
    expect(sessionStorage.getItem('lukas_draft_51')).toBe('Noch nicht bestätigt');
    view.unmount();expect(sessionStorage.getItem('lukas_draft_51')).toBe('Noch nicht bestätigt');
  });
  it('überschreibt bei einer abgewiesenen Rückfrage keinen bestehenden Chatentwurf',async()=>{
    sessionStorage.setItem('lukas_active_chat','51');sessionStorage.setItem('lukas_draft_51','Mein anderer Entwurf');
    const result={surface:'lukas-rueckfrage',id:'frage-fehler',conversationId:51,fragen:[{frage:'Welche Variante möchtest du?',optionen:['Kurz','Ausführlich']}]};
    state.messages=[{id:1,role:'assistant',content:'Bitte wählen',createdAt:new Date().toISOString(),steps:[{tool:'frage_issa',input:'{}',ok:true,result:JSON.stringify(result),ms:1}]}];
    vi.stubGlobal('fetch',vi.fn(async(url:string)=>String(url).endsWith('/messages')?Response.json({error:'Testfehler'},{status:503}):Response.json([])));
    const user=userEvent.setup();render(<Chat/>);
    await user.click(await screen.findByRole('radio',{name:'Kurz'}));await user.click(screen.getByRole('button',{name:'Antwort senden'}));
    await screen.findByText('Die Antwort konnte nicht bestätigt werden. Deine Eingabe bleibt erhalten.');
    expect(sessionStorage.getItem('lukas_draft_51')).toBe('Mein anderer Entwurf');
    expect(document.querySelector('[aria-label="Nachricht an Lukas"]')).toHaveValue('Mein anderer Entwurf');
  });

});
