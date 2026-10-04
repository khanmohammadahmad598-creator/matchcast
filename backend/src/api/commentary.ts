import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { realtime } from '../realtime/io';
import { settings } from '../services/settings';
import { history, saveCommentary } from '../services/commentaryService';
import { speakText } from '../services/streamService';
import { getLiveMatchId } from '../services/matchService';
import { aiSettingsSchema, z } from '@matchcast/shared';

export const commentaryRouter: Router = Router();

const speakSchema = z.object({
  text: z.string().min(1).max(600),
  language: z.enum(['hi', 'hinglish', 'en']).optional(),
  priority: z.number().int().min(0).max(100).optional(),
});

commentaryRouter.use(requireAuth);

commentaryRouter.get('/history', async (req, res, next) => {
  try {
    const matchId = (req.query.matchId as string | undefined) ?? (await getLiveMatchId()) ?? undefined;
    res.json({ items: await history(matchId, Number(req.query.limit ?? 100)) });
  } catch (err) {
    next(err);
  }
});

commentaryRouter.get('/settings', async (_req, res, next) => {
  try {
    res.json({ settings: await settings.ai() });
  } catch (err) {
    next(err);
  }
});

commentaryRouter.put('/settings', requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    const next2 = await settings.setAi(req.body);
    realtime.command('stream-worker', { type: 'tts:settings', payload: await settings.tts() });
    res.json({ settings: next2 });
  } catch (err) {
    next(err);
  }
});

/** Manual line: generate nothing, just speak exactly what the operator typed. */
commentaryRouter.post('/speak', requireRole('ADMIN', 'OPERATOR'), validate(speakSchema), async (req, res, next) => {
  try {
    const { text, language, priority } = req.body as z.infer<typeof speakSchema>;
    const ai = await settings.ai();
    const matchId = (await getLiveMatchId()) ?? undefined;
    if (matchId) {
      await saveCommentary({
        matchId,
        text,
        language: language ?? ai.language,
        style: ai.style,
        provider: 'operator',
        ttsStatus: 'PENDING',
      });
    }
    const delivered = speakText(text, language ?? ai.language, priority ?? 90);
    res.json({ ok: true, delivered });
  } catch (err) {
    next(err);
  }
});

/** Force the engine to call a specific event (used by tests + demo). */
commentaryRouter.post('/trigger', requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    const event = req.body?.event;
    if (!event?.type) return void res.status(400).json({ error: 'event.type required' });
    const delivered = realtime.command('stream-worker', {
      type: 'commentary:trigger',
      payload: { ...event, id: event.id ?? 'manual', createdAt: event.createdAt ?? new Date().toISOString() },
    });
    res.json({ ok: true, delivered });
  } catch (err) {
    next(err);
  }
});

export { aiSettingsSchema };
