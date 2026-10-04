import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../db/prisma';
import { config } from '../core/config';
import { logger } from '../core/logger';
import { realtime } from '../realtime/io';
import { pushGraphicsSettings } from './streamService';
import { settings } from './settings';
import { RESOLUTION_DIMENSIONS } from '@matchcast/shared';
import type { GraphicsSettings, GraphicsTemplate } from '@matchcast/shared';

export const BUILT_IN_TEMPLATES: GraphicsTemplate[] = [
  {
    id: 'cricket-modern',
    name: 'Cricket Modern',
    description: 'Glass-morphism scoreboard with live badge, RRR and recent balls.',
    previewColor: '#00d09c',
    config: {
      templateId: 'cricket-modern',
      accentColor: '#00d09c',
      backgroundColor: '#0b1120',
      textColor: '#ffffff',
      scoreboardPosition: 'bottom-left',
    },
  },
  {
    id: 'cricket-classic',
    name: 'Cricket Classic',
    description: 'Traditional broadcast bar: team colours, solid blocks, high contrast.',
    previewColor: '#f59e0b',
    config: {
      templateId: 'cricket-classic',
      accentColor: '#f59e0b',
      backgroundColor: '#111827',
      textColor: '#ffffff',
      scoreboardPosition: 'bottom-left',
    },
  },
  {
    id: 'cricket-minimal',
    name: 'Cricket Minimal',
    description: 'Slim single-line score bug, ideal for a clean look or small screens.',
    previewColor: '#38bdf8',
    config: {
      templateId: 'cricket-minimal',
      accentColor: '#38bdf8',
      backgroundColor: '#020617',
      textColor: '#f8fafc',
      scoreboardPosition: 'top-left',
      opacity: 0.9,
    },
  },
];

export async function seedTemplates(): Promise<void> {
  for (const t of BUILT_IN_TEMPLATES) {
    await prisma.graphicsTemplate.upsert({
      where: { name: t.id },
      create: {
        name: t.id,
        description: t.description,
        previewColor: t.previewColor,
        config: t.config as object,
        isBuiltIn: true,
      },
      update: { description: t.description, previewColor: t.previewColor },
    });
  }
}

export async function listTemplates(): Promise<GraphicsTemplate[]> {
  const rows = await prisma.graphicsTemplate.findMany({ orderBy: [{ isBuiltIn: 'desc' }, { name: 'asc' }] });
  return rows.map((r) => ({
    id: r.name,
    name: r.name.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    description: r.description,
    previewColor: r.previewColor,
    config: (r.config ?? {}) as Partial<GraphicsSettings>,
  }));
}

export async function saveTemplate(input: {
  name: string;
  description?: string;
  previewColor?: string;
  config: Record<string, unknown>;
}): Promise<GraphicsTemplate> {
  const row = await prisma.graphicsTemplate.upsert({
    where: { name: input.name },
    create: {
      name: input.name,
      description: input.description ?? '',
      previewColor: input.previewColor ?? '#00d09c',
      config: input.config as object,
    },
    update: { description: input.description ?? '', previewColor: input.previewColor ?? '#00d09c', config: input.config as object },
  });
  return {
    id: row.name,
    name: row.name,
    description: row.description,
    previewColor: row.previewColor,
    config: row.config as Partial<GraphicsSettings>,
  };
}

export async function getGraphicsSettings(): Promise<GraphicsSettings> {
  return settings.graphics();
}

/** The overlay canvas must always match the encoder output resolution. */
export async function syncOverlaySize(resolution: string): Promise<void> {
  const dims = RESOLUTION_DIMENSIONS[resolution] ?? RESOLUTION_DIMENSIONS['1080p'];
  const current = await settings.graphics();
  if (current.overlayWidth === dims.width && current.overlayHeight === dims.height) return;
  await updateGraphicsSettings({ overlayWidth: dims.width, overlayHeight: dims.height });
}

export async function updateGraphicsSettings(patch: Partial<GraphicsSettings>): Promise<GraphicsSettings> {
  const next = await settings.setGraphics(patch);
  realtime.graphics(next);
  pushGraphicsSettings(next);
  logger.info('backend', 'Graphics settings updated', { templateId: next.templateId });
  return next;
}

export async function applyTemplate(templateId: string): Promise<GraphicsSettings> {
  const templates = await listTemplates();
  const tpl = templates.find((t) => t.id === templateId);
  if (!tpl) throw new Error(`Unknown template: ${templateId}`);
  const { templateId: _ignored, ...rest } = (tpl.config ?? {}) as GraphicsSettings;
  return updateGraphicsSettings({ ...rest, templateId });
}

/** Stores an uploaded logo/sponsor image and returns its public URL. */
export async function saveUpload(file: { originalname: string; buffer: Buffer }, prefix = 'logo'): Promise<string> {
  const dir = config.MEDIA_DIR;
  fs.mkdirSync(dir, { recursive: true });
  const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  const name = `${prefix}-${Date.now()}-${safe}`;
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, file.buffer);
  return `/media/${name}`;
}

export function mediaFilePath(name: string): string | null {
  const filePath = path.join(config.MEDIA_DIR, path.basename(name));
  return fs.existsSync(filePath) ? filePath : null;
}
