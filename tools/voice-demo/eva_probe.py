"""Read-only regular interview surface probe. No applicant submission or audio session."""
import asyncio
import json
import os
from playwright.async_api import async_playwright
from eva_surface import EvaSurface
from worker import browser_env

async def main():
    async with async_playwright() as p:
        proxy=os.environ.get('HTTPS_PROXY')
        browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,
            env=browser_env(),proxy={'server':proxy} if proxy else None,
            args=['--disable-dev-shm-usage'])
        try:
            page=await browser.new_page()
            surface=EvaSurface(page)
            snapshot=await surface.inspect()
            await page.wait_for_timeout(8000)
            print('EVA_PROBE '+json.dumps({'regular_surface_loaded':True,
                'surface_sha256':snapshot['sha256'],**await surface.readiness(),
                'interview':'nicht gestartet','consents_checked':False}),flush=True)
        except Exception as exc:
            print('EVA_PROBE '+json.dumps({'regular_surface_loaded':False,
                'error_type':type(exc).__name__,'interview':'nicht gestartet'}),flush=True)
            raise SystemExit(1)
        finally: await browser.close()

if __name__=='__main__':asyncio.run(main())
