import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {describe,it,expect,vi,beforeEach} from 'vitest';
import Memory from './memory';
import Goals from './goals';
import Diary from './diary';
import Studio from './studio';
import Zugaenge from './zugaenge';

const state=vi.hoisted(()=>({readError:true,create:vi.fn()}));
vi.mock('@workspace/api-client-react',()=>({
  useGetLukasStatus:()=>({data:{memoriesCount:8}}),
  useGetMemories:()=>({data:undefined,isLoading:false,isError:state.readError,refetch:vi.fn()}),
  useGetGoals:()=>({data:undefined,isLoading:false,isError:state.readError,refetch:vi.fn()}),
  useGetDiaryEntries:()=>({data:undefined,isLoading:false,isError:state.readError,refetch:vi.fn()}),
  useGetMediaJobs:()=>({data:undefined,isLoading:false,isError:state.readError,refetch:vi.fn()}),
  useCreateMemory:()=>({mutateAsync:state.create,isPending:false}),
  useCreateGoal:()=>({mutateAsync:state.create,isPending:false}),
  useDeleteMemory:()=>({mutateAsync:vi.fn()}),useUpdateGoal:()=>({mutateAsync:vi.fn()}),useDeleteGoal:()=>({mutateAsync:vi.fn()}),
  getGetMemoriesQueryKey:()=>['memories'],getGetGoalsQueryKey:()=>['goals'],
  useGenerateHiggsfieldPrompt:()=>({mutateAsync:state.create,isPending:false}),useGenerateMedia:()=>({mutateAsync:vi.fn()}),
  useGetMediaStatus:()=>({}),getGetMediaStatusQueryKey:()=>['media-status'],getGetMediaJobsQueryKey:()=>['jobs'],
}));
const show=(element:React.ReactNode)=>render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}>{element}</QueryClientProvider>);
beforeEach(()=>{state.readError=true;state.create.mockReset().mockRejectedValue(Error('Synthetic write failure'));vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({image:[],video:[]}))));});
describe('Workspace failures remain visible',()=>{
  for(const [name,Component,message,empty] of [
    ['memory',Memory,'Die Erinnerungen konnten nicht geladen werden.','Noch keine Erinnerungen'],
    ['goals',Goals,'Die Ziele konnten nicht geladen werden.','Noch keine Ziele'],
    ['diary',Diary,'Das Tagebuch konnte nicht geladen werden.','Noch nichts geschrieben'],
    ['studio',Studio,'Die Medienaufträge konnten nicht geladen werden.','Noch keine Aufträge'],
  ] as const)it(name+' does not turn a read failure into empty success',()=>{show(<Component/>);expect(screen.getByText(message)).toBeInTheDocument();expect(screen.queryByText(empty)).not.toBeInTheDocument();});
  it('failed memory save keeps its draft and explains the failure',async()=>{
    state.readError=false;show(<Memory/>);fireEvent.click(screen.getByRole('button',{name:'Neue Erinnerung'}));
    fireEvent.change(screen.getByPlaceholderText('Was soll Lukas wissen?'),{target:{value:'Synthetic memory draft'}});fireEvent.click(screen.getByRole('button',{name:/^Speichern$/}));
    await waitFor(()=>expect(screen.getByText('Die Erinnerung konnte nicht gespeichert werden. Dein Entwurf bleibt erhalten.')).toBeInTheDocument());
    expect(screen.getByPlaceholderText('Was soll Lukas wissen?')).toHaveValue('Synthetic memory draft');
  });
  it('failed goal save keeps its draft and explains the failure',async()=>{
    state.readError=false;show(<Goals/>);fireEvent.click(screen.getByRole('button',{name:'Neues Ziel'}));
    fireEvent.change(screen.getByPlaceholderText('Worum geht es?'),{target:{value:'Synthetic goal'}});fireEvent.change(screen.getByPlaceholderText('Was genau ist das Ziel? Warum ist es wichtig?'),{target:{value:'Synthetic description'}});fireEvent.click(screen.getByRole('button',{name:'Ziel setzen'}));
    await waitFor(()=>expect(screen.getByText('Das Ziel konnte nicht gespeichert werden. Dein Entwurf bleibt erhalten.')).toBeInTheDocument());
    expect(screen.getByPlaceholderText('Worum geht es?')).toHaveValue('Synthetic goal');
  });
  it('Studio catches prompt failure and preserves the vision',async()=>{
    state.readError=false;show(<Studio/>);
    const vision=screen.getByPlaceholderText(/Eine Frau in einem nebligen/);fireEvent.change(vision,{target:{value:'Synthetic vision'}});
    fireEvent.click(screen.getByRole('button',{name:/Prompt/}));
    await waitFor(()=>expect(screen.getByText('Der Prompt konnte nicht erstellt werden. Deine Eingaben bleiben erhalten.')).toBeInTheDocument());
    expect(vision).toHaveValue('Synthetic vision');
  });
  it('vault read failure is not an empty vault',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{}',{status:503})));show(<Zugaenge/>);
    await waitFor(()=>expect(screen.getByText('Die Zugänge konnten nicht geladen werden.')).toBeInTheDocument());
    expect(screen.queryByText('Noch nichts hinterlegt')).not.toBeInTheDocument();
  });
});
