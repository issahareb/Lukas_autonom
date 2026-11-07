import {render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {expect,it,vi} from 'vitest';
import {RueckfrageFenster,rueckfrageAus,type Rueckfrage} from './rueckfrage';
const frage:Rueckfrage={surface:'lukas-rueckfrage',id:'q',conversationId:9,fragen:[{frage:'Welcher Termin?',optionen:['Montag','Dienstag']}]};
it('behält Antworten nach Schließen und nach einem Sendeproblem',async()=>{
  const user=userEvent.setup(),send=vi.fn().mockResolvedValue(false);render(<RueckfrageFenster frage={frage} busy={false} antworten={send}/>);
  await user.type(screen.getByRole('textbox'), 'Mittwoch');await user.click(screen.getByRole('button',{name:'Später'}));
  expect(screen.queryByRole('dialog')).toBeNull();await user.click(screen.getByRole('button',{name:'Rückfrage beantworten'}));
  expect(screen.getByRole('textbox')).toHaveValue('Mittwoch');await user.click(screen.getByRole('button',{name:'Antwort senden'}));
  await screen.findByRole('alert');expect(screen.getByRole('textbox')).toHaveValue('Mittwoch');
  expect(send).toHaveBeenCalledTimes(1);
});
it('akzeptiert nur erfolgreiche strukturierte Fragen des aktiven Gesprächs',()=>{
  const step={tool:'frage_issa',input:'{}',ok:true,result:JSON.stringify(frage),ms:1};
  expect(rueckfrageAus([step],9)?.id).toBe('q');expect(rueckfrageAus([step],10)).toBeNull();
  expect(rueckfrageAus([{...step,ok:false}],9)).toBeNull();
  expect(rueckfrageAus([{...step,tool:'fetch_url'}],9)).toBeNull();
  expect(rueckfrageAus([{...step,result:'Was möchtest du?'}],9)).toBeNull();
});
