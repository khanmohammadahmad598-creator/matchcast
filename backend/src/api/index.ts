import { Router } from 'express';
import { authRouter } from './auth';
import { matchesRouter } from './matches';
import { scoringRouter } from './scoring';
import { commentaryRouter } from './commentary';
import { ttsRouter } from './tts';
import { graphicsRouter } from './graphics';
import { streamingRouter } from './streaming';
import { systemRouter } from './system';
import { internalRouter } from './internal';

export const apiRouter: Router = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/matches', matchesRouter);
// Scoring routes already carry the /match prefix (public provider contract:
// POST /api/match/update), so they mount at the API root.
apiRouter.use('/', scoringRouter);
apiRouter.use('/commentary', commentaryRouter);
apiRouter.use('/tts', ttsRouter);
apiRouter.use('/graphics', graphicsRouter);
apiRouter.use('/stream', streamingRouter);
apiRouter.use('/system', systemRouter);
apiRouter.use('/internal', internalRouter); // worker-only

apiRouter.get('/', (_req, res) => {
  res.json({
    name: 'MatchCast API',
    version: '1.0.0',
    endpoints: [
      'POST /api/auth/login',
      'GET  /api/matches',
      'POST /api/match/update',
      'GET  /api/match/state',
      'POST /api/match/:id/ball',
      'GET  /api/commentary/history',
      'PUT  /api/commentary/settings',
      'PUT  /api/tts/settings',
      'PUT  /api/graphics/settings',
      'GET  /api/stream/status',
      'POST /api/stream/start',
      'GET  /api/system/logs',
    ],
  });
});
