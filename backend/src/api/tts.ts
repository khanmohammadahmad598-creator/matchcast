import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth';
import { settings } from '../services/settings';
import { pushTtsSettings, speakText } from '../services/streamService';
import { realtime } from '../realtime/io';
import { prisma } from '../db/prisma';

export const ttsRouter: Router = Router();

ttsRouter.use(requireAuth);

ttsRouter.get('/settings', async (_req, res, next) => {
  try {
    res.json({ settings: await settings.tts() });
  } catch (err) {
    next(err);
  }
});

ttsRouter.put('/settings', requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    const next = await settings.setTts(req.body);
    pushTtsSettings(next);
    res.json({ settings: next });
  } catch (err) {
    next(err);
  }
});

/** Voice catalogue exposed by the configured provider (never includes secrets). */
ttsRouter.get('/voices', async (_req, res) => {
  const tts = await settings.tts();
  res.json({
    provider: tts.provider,
    voices: [
      { id: 'hi-male', name: 'Hindi - Male', language: 'hi', gender: 'male' },
      { id: 'hi-female', name: 'Hindi - Female', language: 'hi', gender: 'female' },
      { id: 'en-male', name: 'English - Male', language: 'en', gender: 'male' },
      { id: 'en-female', name: 'English - Female', language: 'en', gender: 'female' },
      { id: 'hinglish-male', name: 'Hinglish - Male', language: 'hinglish', gender: 'male' },
      { id: 'hinglish-female', name: 'Hinglish - Female', language: 'hinglish', gender: 'female' },
    ],
  });
});

ttsRouter.post('/speak', requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    const text = String(req.body?.text ?? '').slice(0, 600);
    if (!text) return void res.status(400).json({ error: 'text required' });
    const delivered = speakText(text, req.body?.language, Number(req.body?.priority ?? 80));
    res.json({ ok: true, delivered });
  } catch (err) {
    next(err);
  }
});

ttsRouter.post('/clear', requireRole('ADMIN', 'OPERATOR'), (_req, res) => {
  const delivered = realtime.command('stream-worker', { type: 'tts:clear' });
  res.json({ ok: true, delivered });
});

ttsRouter.get('/audio', async (_req, res, next) => {
  try {
    const rows = await prisma.ttsAudio.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
    res.json({ items: rows });
  } catch (err) {
    next(err);
  }
});
