import {render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe,it,expect,vi} from 'vitest';
import VerbrauchFallstudie from './verbrauch-fallstudie';
const bericht={stand:'2026-11-14T12:00:00Z',nachweis:{sha256:'abc123'},methodik:{grenzen:['VPS noch nicht zentral erfasst.']},aktuell:{zeitraum:{von:'2026-11-07',bis:'2026-11-13'},abdeckung:{aufrufe:9,gemessen:8,ohneMesswert:1,abgenommen:2,auftraege:3,nurBeleg:0},bereiche:[{kanal:'chat',aufgabenart:'coding',model:'test-model',phase:'fallback',aufrufe:9,gesamt:1234,ohneMesswert:1}]},vorher:{zeitraum:{von:'2026-10-31',bis:'2026-11-06'}},vergleich:[{key:'test',kanal:'chat',aufgabenart:'coding',fall:'fix-1',bewertung:'nicht_belastbar',aenderungProzent:null,gruende:['Fehlende Abnahme.'],aktuell:{tokensJeErfolg:null},vorher:{tokensJeErfolg:1000}}],abgleich:{aktuell:{passt:false,differenz:100},vorher:{passt:true,differenz:0}}};
describe('Token-Fallstudie',()=>{
 it('zeigt Grenzen und fehlende Abnahme statt einer erfundenen Einsparung',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json(bericht)));render(<VerbrauchFallstudie/>);
  expect(await screen.findByText(/Noch nicht belastbar/)).toBeInTheDocument();expect(screen.getByText('Fehlende Abnahme.')).toBeInTheDocument();
  expect(screen.getByText(/8 von 9 Aufrufen/)).toBeInTheDocument();expect(screen.getByText(/Kosten sind unbekannt/)).toBeInTheDocument();
  await userEvent.click(screen.getByText('Verbrauch nach Aufgabenart und Phase'));expect(screen.getByText('test-model · fallback')).toBeInTheDocument();
 });
 it('übergibt historische Datumsgrenzen und behält den alten Bericht bei Fehlern',async()=>{
  const fetch=vi.fn().mockResolvedValueOnce(Response.json(bericht)).mockResolvedValue(new Response('',{status:503}));vi.stubGlobal('fetch',fetch);localStorage.setItem('lukas_token','test');
  render(<VerbrauchFallstudie/>);await screen.findByText(/Noch nicht belastbar/);
  await userEvent.type(screen.getByLabelText('Fallstudie von'),'2026-10-24');await userEvent.type(screen.getByLabelText('Fallstudie bis'),'2026-11-06');await userEvent.click(screen.getByRole('button',{name:'Vergleichen'}));
  await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('vorherigen Werte'));
  expect(fetch.mock.calls[1][0]).toBe('/api/lukas/verbrauch/fallstudie?von=2026-10-24&bis=2026-11-06');expect(fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer test');
  expect(screen.getByText(/Noch nicht belastbar/)).toBeInTheDocument();
 });
});
