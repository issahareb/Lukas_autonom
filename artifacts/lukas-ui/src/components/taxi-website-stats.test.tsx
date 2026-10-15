import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TaxiWebsiteStats from './taxi-website-stats';
const metrics={fetchedAt:'2026-10-15T20:00:00Z',rangeDays:30,summary:{sessions:9,pageviews:14},funnel:{formStartSessions:2,formSubmitSessions:1},clicks:[{target:'phone_header',clicks:5,sessions:3}]};
describe('TaxiBB website metrics',()=>{
 it('shows actual per-position counts and refetches the chosen period',async()=>{
  const fetch=vi.fn().mockImplementation(()=>Promise.resolve(new Response(JSON.stringify(metrics))));vi.stubGlobal('fetch',fetch);
  render(<TaxiWebsiteStats/>);
  expect(await screen.findByText('Anruf · Header')).toBeInTheDocument();expect(screen.getByText('5')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('TaxiBB Messzeitraum'),{target:{value:'7'}});
  await waitFor(()=>expect(fetch.mock.calls.at(-1)?.[0]).toContain('days=7'));
 });
 it('does not turn a connection error into zero visitors',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{}',{status:503})));
  render(<TaxiWebsiteStats/>);expect(await screen.findByRole('alert')).toHaveTextContent('konnten nicht geladen');expect(screen.queryByText('0')).not.toBeInTheDocument();
 });
 it('distinguishes a valid empty period from an error',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({...metrics,clicks:[]}))));
  render(<TaxiWebsiteStats/>);expect(await screen.findByText(/noch keine Buttonklicks/)).toBeInTheDocument();expect(screen.queryByRole('alert')).not.toBeInTheDocument();
 });
});
