import { Router } from 'express';
import { baueGehirn } from '../lib/gehirn';
import { publicBrain, type PublicBrain } from '../lib/public-brain';

const router = Router();
let cached: { value: PublicBrain; expires: number } | null = null;
let pending: Promise<PublicBrain> | null = null;

/** Read-only, anonymous topology for Issa's portfolio; private API auth stays intact. */
router.get('/public/lukas-brain', async (_req, res) => {
  try {
    if (!cached || Date.now() >= cached.expires) {
      pending ??= baueGehirn().then(graph => {
        const value = publicBrain(graph);
        cached = { value, expires: Date.now() + 300_000 };
        return value;
      }).finally(() => { pending = null; });
      await pending;
    }
    res.set('Cache-Control', 'public, max-age=60, s-maxage=300');
    res.json(cached!.value);
  } catch {
    res.set('Retry-After', '60');
    res.status(503).json({ error: 'Brain view temporarily unavailable' });
  }
});

export default router;
