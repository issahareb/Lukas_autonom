import unittest
from eva_surface import EvaSurface

class TestGate(unittest.IsolatedAsyncioTestCase):
    async def test_no_page_action_without_all_acceptance_checks(self):
        class Page:
            def __getattribute__(self,name):raise AssertionError('Browser accessed before gate')
        surface=EvaSurface(Page())
        for review in ({},{'consents_reviewed':True,'ai_demo_allowed':True}):
            with self.assertRaisesRegex(RuntimeError,'incomplete'):
                await surface.start_reviewed(review)


class TestRegularUiGate(unittest.IsolatedAsyncioTestCase):
    async def test_security_and_identity_gate_then_reviewed_click(self):
        from playwright.async_api import async_playwright
        async with async_playwright() as p:
            browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True)
            try:
                page=await browser.new_page()
                await page.set_content('''<input type="text" value="Test"><input type="email" value="test@example.invalid">
                  <input name="cf-turnstile-response" type="hidden" value="">
                  <label><input type="checkbox">Test-Datenschutz</label>
                  <label><input type="checkbox">Test-Aufzeichnung</label>
                  <button onclick="window.clicked=true">Voice Interview starten</button>''')
                surface=EvaSurface(page)
                review={k:True for k in ('real_voice_test_passed','knowledge_test_passed',
                    'interrupt_test_passed','stop_test_passed','consents_reviewed',
                    'ai_demo_allowed','existing_application_linked','microphone_preflight_passed')}
                review.update(surface_sha256=(await surface.snapshot())['sha256'],frame_index=0,
                    consent_labels=['Test-Datenschutz','Test-Aufzeichnung'])
                with self.assertRaisesRegex(RuntimeError,'Security check'):
                    await surface.start_reviewed(review)
                self.assertFalse(await page.evaluate('!!window.clicked'))
                # This is solely a locally created fixture, never the real challenge.
                await page.locator('[name="cf-turnstile-response"]').evaluate('(e)=>e.remove()')
                review['surface_sha256']=(await surface.snapshot())['sha256']
                review['existing_application_linked']=False
                with self.assertRaisesRegex(RuntimeError,'Existing application'):
                    await surface.start_reviewed(review)
                review['existing_application_linked']=True
                result=await surface.start_reviewed(review)
                self.assertTrue(await page.evaluate('window.clicked'))
                self.assertTrue(await page.get_by_label('Test-Datenschutz').is_checked())
                self.assertFalse(result['completion_confirmed'])
                self.assertIn('unbestätigt',result['interview'])
            finally:await browser.close()

if __name__=='__main__':unittest.main()
