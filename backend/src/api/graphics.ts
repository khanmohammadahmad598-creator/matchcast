import { Router } from 'express';
import multer from 'multer';
import { requireAuth, requireRole } from '../middleware/auth';
import {
  applyTemplate,
  getGraphicsSettings,
  listTemplates,
  saveTemplate,
  saveUpload,
  updateGraphicsSettings,
} from '../services/graphicsService';
import { flashGraphic } from '../services/streamService';
import { config } from '../core/config';
import { HttpError } from '../middleware/error';
import { settings } from '../services/settings';

export const graphicsRouter: Router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!/^image\/(png|jpeg|jpg|webp|svg\+xml)$/.test(file.mimetype)) {
      cb(new HttpError(400, 'Only PNG, JPG, WEBP or SVG images are allowed'));
      return;
    }
    cb(null, true);
  },
});

graphicsRouter.use(requireAuth);

graphicsRouter.get('/settings', async (_req, res, next) => {
  try {
    res.json({ settings: await getGraphicsSettings() });
  } catch (err) {
    next(err);
  }
});

graphicsRouter.put('/settings', requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    res.json({ settings: await updateGraphicsSettings(req.body) });
  } catch (err) {
    next(err);
  }
});

graphicsRouter.get('/templates', async (_req, res, next) => {
  try {
    res.json({ templates: await listTemplates() });
  } catch (err) {
    next(err);
  }
});

graphicsRouter.post('/templates', requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    const body = req.body ?? {};
    if (!body.name) return void res.status(400).json({ error: 'name required' });
    res.status(201).json({ template: await saveTemplate(body) });
  } catch (err) {
    next(err);
  }
});

graphicsRouter.post('/templates/:id/apply', requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    res.json({ settings: await applyTemplate(req.params.id) });
  } catch (err) {
    next(err);
  }
});

/** Upload a team/sponsor logo. Returns a URL usable in graphics settings. */
graphicsRouter.post('/upload', requireRole('ADMIN', 'OPERATOR'), upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return void res.status(400).json({ error: 'file required' });
    const url = await saveUpload(req.file, String(req.body?.prefix ?? 'logo'));
    res.status(201).json({ url });
  } catch (err) {
    next(err);
  }
});

/** Show a lower third / breaking-event graphic right now. */
graphicsRouter.post('/flash', requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    const { title, subtitle, ms } = (req.body ?? {}) as { title?: string; subtitle?: string; ms?: number };
    if (!title) return void res.status(400).json({ error: 'title required' });
    const delivered = flashGraphic(title, subtitle, ms);
    const gs = await settings.graphics();
    const merged = await updateGraphicsSettings({
      lowerThirdVisible: true,
      lowerThirdTitle: title,
      lowerThirdSubtitle: subtitle ?? null,
    });
    if (ms && ms > 0) {
      setTimeout(() => {
        void updateGraphicsSettings({
          lowerThirdVisible: false,
          lowerThirdTitle: gs.lowerThirdTitle ?? null,
          lowerThirdSubtitle: gs.lowerThirdSubtitle ?? null,
        });
      }, Math.min(60_000, ms)).unref();
    }
    res.json({ ok: true, delivered, settings: merged });
  } catch (err) {
    next(err);
  }
});

export { config };
