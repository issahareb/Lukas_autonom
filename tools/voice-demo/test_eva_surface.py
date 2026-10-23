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

if __name__=='__main__':unittest.main()
