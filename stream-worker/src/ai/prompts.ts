import type { CommentaryStyle, Language, MatchEvent } from '@matchcast/shared';

const LANGUAGE_RULE: Record<Language, string> = {
  hi: 'Write ONLY in Hindi (Devanagari script). Natural, broadcast-ready Hindi.',
  hinglish: 'Write in Hinglish: Hindi sentence structure written with Latin/Roman script, mixing common English cricket terms (four, six, wicket, over, run rate). This is how Indian TV commentators speak.',
  en: 'Write in clear, natural English.',
};

const STYLE_RULE: Record<CommentaryStyle, string> = {
  professional: 'Calm, authoritative broadcast tone. Measured, accurate, no slang.',
  excited: 'High-energy commentary. Big moments get real emotion, exclamation marks allowed.',
  calm: 'Relaxed, understated, almost whispering. Minimal punctuation drama.',
  fast: 'Very short, punchy sentences. Maximum 10-12 words. Rapid-fire delivery.',
  expert: 'Tactically rich: mention field placement, bowler length, match-ups and pressure.',
};

export function buildSystemPrompt(language: Language, style: CommentaryStyle, maxChars: number, avoid: string[] = []): string {
  return [
    'You are a professional live cricket television commentator calling a match for a licensed broadcast.',
    LANGUAGE_RULE[language],
    STYLE_RULE[style],
    `Rules:`,
    `1. Output ONE single line of commentary, at most ${maxChars} characters.`,
    `2. Only use facts present in the JSON payload. Never invent players, scores, events or statistics.`,
    `3. No prefixes, no quotes, no stage directions, no emojis, no markdown.`,
    `4. No commentary about events that did not happen (no "almost", no "nearly" unless stated).`,
    `5. Do not repeat or closely paraphrase any of these recent lines: ${avoid.length ? avoid.map((a) => `"${a}"`).join(', ') : '(none yet)'}.`,
    `6. If the payload describes nothing worth calling, reply with exactly: SKIP`,
    `7. Transliterate player names as given in the payload.`,
  ].join('\n');
}

export function buildUserPrompt(
  language: Language,
  style: CommentaryStyle,
  event: MatchEvent,
  facts: Record<string, unknown>,
): string {
  // The user message doubles as the deterministic-envelope format consumed by
  // the offline rule-based provider, which keeps both paths in lockstep.
  return JSON.stringify({
    language,
    style,
    eventType: event.type,
    headline: event.headline,
    facts,
    instruction: `Call this moment: ${event.headline}. Keep it under the character limit. If there is genuinely nothing to say, reply with exactly: SKIP`,
  });
}
