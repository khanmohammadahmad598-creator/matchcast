import { prisma } from '../db/prisma';
import { logger } from '../core/logger';
import { realtime } from '../realtime/io';
import type { CommentaryItem, Language } from '@matchcast/shared';

/**
 * Backend side of commentary: persistence, history and operator actions.
 * Generation + synthesis happen in the stream-worker (it owns the audio graph),
 * which reports finished lines back through POST /api/internal/commentary.
 */

function mapRow(r: {
  id: string;
  matchId: string;
  language: string;
  style: string;
  text: string;
  eventType: string | null;
  provider: string;
  spoken: boolean;
  ttsStatus: string;
  audioUrl: string | null;
  durationMs: number | null;
  createdAt: Date;
}): CommentaryItem {
  return {
    id: r.id,
    matchId: r.matchId,
    language: r.language as Language,
    style: r.style as CommentaryItem['style'],
    text: r.text,
    eventType: (r.eventType as CommentaryItem['eventType']) ?? null,
    provider: r.provider,
    spoken: r.spoken,
    ttsStatus: r.ttsStatus as CommentaryItem['ttsStatus'],
    audioUrl: r.audioUrl,
    durationMs: r.durationMs,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function saveCommentary(input: {
  matchId: string;
  text: string;
  language: string;
  style: string;
  eventType?: string | null;
  provider: string;
  ttsStatus?: string;
  audioUrl?: string | null;
  durationMs?: number | null;
  spoken?: boolean;
}): Promise<CommentaryItem> {
  const row = await prisma.commentary.create({
    data: {
      matchId: input.matchId,
      text: input.text.slice(0, 1000),
      language: input.language,
      style: input.style,
      eventType: (input.eventType as never) ?? null,
      provider: input.provider,
      ttsStatus: (input.ttsStatus as never) ?? 'PENDING',
      audioUrl: input.audioUrl ?? null,
      durationMs: input.durationMs ?? null,
      spoken: input.spoken ?? false,
    },
  });
  const item = mapRow(row);
  realtime.commentary(item);
  return item;
}

export async function updateCommentaryTts(
  id: string,
  patch: { ttsStatus?: string; audioUrl?: string | null; durationMs?: number | null; spoken?: boolean },
): Promise<CommentaryItem | null> {
  try {
    const row = await prisma.commentary.update({
      where: { id },
      data: {
        ...(patch.ttsStatus ? { ttsStatus: patch.ttsStatus as never } : {}),
        ...(patch.audioUrl !== undefined ? { audioUrl: patch.audioUrl } : {}),
        ...(patch.durationMs !== undefined ? { durationMs: patch.durationMs } : {}),
        ...(patch.spoken !== undefined ? { spoken: patch.spoken } : {}),
      },
    });
    const item = mapRow(row);
    realtime.commentary(item);
    return item;
  } catch (err) {
    logger.warn('ai', 'Failed to update commentary row', { id, error: (err as Error).message });
    return null;
  }
}

export async function history(matchId?: string, take = 100): Promise<CommentaryItem[]> {
  const rows = await prisma.commentary.findMany({
    where: matchId ? { matchId } : {},
    orderBy: { createdAt: 'desc' },
    take: Math.min(500, take),
  });
  return rows.map(mapRow).reverse();
}

export async function registerTtsAudio(input: {
  commentaryId?: string | null;
  provider: string;
  voice?: string | null;
  language?: string | null;
  text: string;
  cacheKey: string;
  filePath: string;
  format: string;
  durationMs?: number | null;
  sizeBytes?: number | null;
}): Promise<void> {
  await prisma.ttsAudio.upsert({
    where: { cacheKey: input.cacheKey },
    create: {
      commentaryId: input.commentaryId ?? null,
      provider: input.provider,
      voice: input.voice ?? null,
      language: input.language ?? null,
      text: input.text.slice(0, 1000),
      cacheKey: input.cacheKey,
      filePath: input.filePath,
      format: input.format,
      durationMs: input.durationMs ?? null,
      sizeBytes: input.sizeBytes ?? null,
    },
    update: { filePath: input.filePath, sizeBytes: input.sizeBytes ?? null },
  });
}
