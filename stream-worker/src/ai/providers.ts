import { config } from '../core/config';
import type { CommentaryStyle, Language, MatchEvent } from '@matchcast/shared';
import { buildSystemPrompt, buildUserPrompt } from './prompts';
import { fmt } from '@matchcast/shared';

export interface AiRequest {
  system: string;
  user: string;
  maxChars: number;
  temperature: number;
}

export interface AiProvider {
  readonly name: string;
  available(): boolean;
  complete(req: AiRequest): Promise<string>;
}

const TIMEOUT_MS = 12_000;

export const openAiProvider: AiProvider = {
  name: 'openai',
  available: () => Boolean(config.OPENAI_API_KEY),
  async complete(req) {
    const res = await fetch(`${config.OPENAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.OPENAI_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: config.OPENAI_MODEL,
        temperature: req.temperature,
        max_tokens: Math.ceil(req.maxChars * 2.2),
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return json.choices?.[0]?.message?.content?.trim() ?? '';
  },
};

export const anthropicProvider: AiProvider = {
  name: 'anthropic',
  available: () => Boolean(config.ANTHROPIC_API_KEY),
  async complete(req) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': config.ANTHROPIC_API_KEY ?? '',
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: config.ANTHROPIC_MODEL,
        max_tokens: Math.ceil(req.maxChars * 2.2),
        temperature: req.temperature,
        system: req.system,
        messages: [{ role: 'user', content: req.user }],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as { content?: Array<{ text?: string }> };
    return json.content?.map((c) => c.text ?? '').join(' ').trim() ?? '';
  },
};

export const geminiProvider: AiProvider = {
  name: 'gemini',
  available: () => Boolean(config.GEMINI_API_KEY),
  async complete(req) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.GEMINI_MODEL}:generateContent?key=${config.GEMINI_API_KEY}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.system }] },
        contents: [{ role: 'user', parts: [{ text: req.user }] }],
        generationConfig: { temperature: req.temperature, maxOutputTokens: Math.ceil(req.maxChars * 2.2) },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    return json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join(' ').trim() ?? '';
  },
};

/* ------------------------------------------------------------------ */
/* Deterministic, offline provider (always available, zero cost)       */
/* ------------------------------------------------------------------ */

type EventKey = 'SIX' | 'FOUR' | 'WICKET' | 'MILESTONE' | 'BALL' | 'OVER_END' | 'INNINGS_END' | 'MATCH_START';

const BANK: Record<Language, Record<EventKey, string[]>> = {
  hi: {
    SIX: [
      'और ये शानदार छक्का! {batter} ने {bowler} की गेंद को सीमा पार भेज दिया, {team} के खाते में छह रन।',
      'कमाल का शॉट! {batter} ने गेंद को पकड़ा और स्टैंड में पहुँचा दिया - पूरे छह रन।',
      '{bowler} की गेंद छोटी रही और {batter} ने उसे छक्के में बदल दिया, शानदार टाइमिंग।',
    ],
    FOUR: [
      'और ये शानदार चौका! गेंद को गैप मिला और बल्लेबाज़ ने चार रन अपने नाम कर लिए।',
      'चौका! {batter} ने गेंद को कवर क्षेत्र से गुज़ारा, फील्डर को कोई मौका नहीं मिला।',
      '{bowler} की गेंद पर {batter} ने शानदार प्लेसमेंट किया, चार रन {team} के खाते में।',
    ],
    WICKET: [
      'आउट! {bowler} ने {batter_out} को पवेलियन भेज दिया। {team} का स्कोर अब {score}।',
      'विकेट! {dismissal} - {batter_out} वापस लौटे, और {team} को लगा झटका।',
      'बड़ी सफलता गेंदबाज़ को! {bowler} ने {batter_out} की पारी का अंत कर दिया।',
    ],
    MILESTONE: [
      'शानदार पारी! {batter} ने अपना {milestone} पूरा कर लिया है, दर्शकों की तालियों से स्टेडियम गूँज उठा।',
      '{batter} के लिए ऐतिहासिक पल - {milestone} पूरा, और यह पारी अब याद रखी जाएगी।',
    ],
    BALL: [
      '{bowler} की गेंद, {batter} ने {runs} रन लिए। {team} का स्कोर अब {score}।',
      '{runs} रन आए, {team} {score} पर पहुँच गई है।',
    ],
    OVER_END: [
      'ओवर समाप्त। {team} का स्कोर {score}, {overs} ओवर पूरे।',
      '{overs} ओवर के बाद {team} {score} पर, रन रेट {run_rate}।',
    ],
    INNINGS_END: [
      'पारी समाप्त! {team} ने {overs} ओवर में {score} रन बनाए।',
      'इस पारी का अंत - {team} का स्कोर {score}, और अब अगली पारी का इंतज़ार।',
    ],
    MATCH_START: [
      'मैच शुरू! {batting_team} बल्लेबाज़ी कर रही है और {bowling_team} मैदान में उतरी है।',
      'लाइव प्रसारण में आपका स्वागत है - {batting_team} बनाम {bowling_team}।',
    ],
  },
  hinglish: {
    SIX: [
      'Aur yeh chhakka! {batter} ne {bowler} ki ball ko stadium ke bahar bhej diya - pooray chhe runs.',
      'Kamaal ka shot! {batter} ne is ball ko chhe maar diya, {team} ab {score} par.',
      'Bada hit! {batter} ne timing dikhayi aur ball boundary ke paar gayi, six runs.',
    ],
    FOUR: [
      'Aur yeh chauika! ball ko gap mila aur {batter} ne chaar run apne naam kar liye.',
      'Four runs! {batter} ne {bowler} ki ball ko cover se guzara, fielder ko koi chance nahi mila.',
      'Shandaar placement, {batter} ne chheh nahi chaar run liye - {team} ab {score}.',
    ],
    WICKET: [
      'Out! {bowler} ne {batter_out} ko pavilion bhej diya. {team} ka score ab {score}.',
      'Wicket! {dismissal} - {batter_out} out, aur {team} ko laga bada jhatka.',
      'Badi safalta! {bowler} ne {batter_out} ki innings ka ant kar diya, score {score}.',
    ],
    MILESTONE: [
      'Shandaar! {batter} ne apna {milestone} poora kar liya hai, stadium talio se goonj utha.',
      'Milestone alert - {batter} ne {milestone} complete kiya, kamaal ki batting.',
    ],
    BALL: [
      '{bowler} ki ball, {batter} ne {runs} run liye. {team} ab {score} par.',
      '{runs} run aaye, {team} ka score ho gaya {score}.',
    ],
    OVER_END: [
      'Over khatam. {team} ka score {score}, {overs} overs complete.',
      '{overs} overs ke baad {team} {score} par, run rate {run_rate}.',
    ],
    INNINGS_END: [
      'Innings khatam! {team} ne {overs} overs mein {score} banaye.',
      'Pari ka ant - {team} ka final score {score}.',
    ],
    MATCH_START: [
      'Match shuru! {batting_team} batting kar rahi hai aur {bowling_team} fielding kar rahi hai.',
      'Live broadcast mein aapka swagat hai - {batting_team} vs {bowling_team}.',
    ],
  },
  en: {
    SIX: [
      'And that is a massive six! {batter} sends {bowler} out of the ground.',
      'Clean strike! {batter} gets hold of it and it sails over the ropes for six.',
      'Six runs! {batter} picks the length early and deposits it into the stands.',
    ],
    FOUR: [
      'And a gorgeous four! Pure timing from {batter}, the gap was found and the ball races away.',
      'Four more! {batter} threads it past the fielder, {team} move to {score}.',
      'Beautifully placed - {batter} collects four off {bowler}.',
    ],
    WICKET: [
      'Wicket! {bowler} gets {batter_out}, {dismissal}. {team} are {score}.',
      'Gone! {batter_out} has to walk back - a big breakthrough for the bowling side.',
      'That is the breakthrough! {bowler} removes {batter_out}, score {score}.',
    ],
    MILESTONE: [
      'Milestone moment! {batter} brings up a well-deserved {milestone}.',
      'Take a bow, {batter} - that is a {milestone}, and the crowd is on its feet.',
    ],
    BALL: [
      '{bowler} to {batter}, {runs} run(s) taken. {team} are {score}.',
      '{runs} run(s) off the ball, {team} move to {score}.',
    ],
    OVER_END: [
      'End of the over: {team} are {score} after {overs} overs.',
      '{overs} overs gone, {team} {score}, run rate {run_rate}.',
    ],
    INNINGS_END: [
      'Innings closed: {team} finish on {score} from {overs} overs.',
      'That is the end of the innings - {team} post {score}.',
    ],
    MATCH_START: [
      'We are underway! {batting_team} are batting, {bowling_team} are out in the field.',
      'Welcome to the live broadcast of {batting_team} against {bowling_team}.',
    ],
  },
};

const STYLE_TWEAK: Record<CommentaryStyle, (line: string, language: Language) => string> = {
  professional: (line) => line,
  excited: (line, lang) =>
    lang === 'hi' ? `क्या बात है! ${line}` : lang === 'hinglish' ? `Kya baat hai! ${line}` : `What a moment! ${line}`,
  calm: (line) => line.replace(/!+/g, '.').replace(/शानदार/g, 'शांत'),
  fast: (line) => line.split(/[।.]/)[0]?.trim() + (line.includes('।') ? '।' : '.'),
  expert: (line, lang) => {
    const analysis =
      lang === 'hi'
        ? ' गेंदबाज़ की लाइन लंबी रही।'
        : lang === 'hinglish'
          ? ' Bowler ki line thodi lambi thi.'
          : ' The length was slightly too full.';
    return `${line}${analysis}`;
  },
};

/** Deterministic generator: same facts + same style => varied but grounded lines. */
export const ruleBasedProvider: AiProvider = {
  name: 'rule-based',
  available: () => true,
  async complete(req) {
    // The user payload carries a JSON envelope with the facts + generation hints.
    const parsed = parseEnvelope(req.user);
    const bank = BANK[parsed.language] ?? BANK.en;
    const key = (parsed.eventType ?? 'BALL') as EventKey;
    const templates = bank[key] ?? bank.BALL;
    const template = templates[Math.floor(Math.random() * templates.length)] ?? templates[0];
    const line = fmt(template, parsed.facts);
    return STYLE_TWEAK[parsed.style](line, parsed.language).trim();
  },
};

interface Envelope {
  language: Language;
  style: CommentaryStyle;
  eventType?: string;
  facts: Record<string, string | number | null | undefined>;
}

function parseEnvelope(user: string): Envelope {
  try {
    return JSON.parse(user) as Envelope;
  } catch {
    return { language: 'en', style: 'professional', facts: {} };
  }
}

export const AI_PROVIDERS: Record<string, AiProvider> = {
  openai: openAiProvider,
  anthropic: anthropicProvider,
  gemini: geminiProvider,
  'rule-based': ruleBasedProvider,
};

export function resolveAiProvider(requested: string): AiProvider {
  if (requested !== 'auto') {
    const p = AI_PROVIDERS[requested];
    if (p && (p.available() || requested === 'rule-based')) return p;
  }
  for (const name of ['openai', 'anthropic', 'gemini']) {
    const p = AI_PROVIDERS[name];
    if (p?.available()) return p;
  }
  return ruleBasedProvider;
}

/** Convenience helper used by the engine. */
export async function generateLine(
  provider: AiProvider,
  opts: { language: Language; style: CommentaryStyle; event: MatchEvent; facts: Record<string, unknown>; maxChars: number; temperature: number; avoid: string[] },
): Promise<string> {
  const { system, user } = {
    system: buildSystemPrompt(opts.language, opts.style, opts.maxChars, opts.avoid),
    user: buildUserPrompt(opts.language, opts.style, opts.event, opts.facts),
  };
  const raw = await provider.complete({ system, user, maxChars: opts.maxChars, temperature: opts.temperature });
  return sanitiseLine(raw, opts.maxChars);
}

export function sanitiseLine(raw: string, maxChars: number): string {
  const line = raw
    .replace(/^["'““”‘’]+|["'““”‘’]+$/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^(Commentary|Commentator|AI)\s*:\s*/i, '')
    .trim();
  if (!line) return '';
  if (line.length <= maxChars) return line;
  const cut = line.slice(0, maxChars);
  const lastStop = Math.max(cut.lastIndexOf('.'), cut.lastIndexOf('!'), cut.lastIndexOf('।'), cut.lastIndexOf('?'));
  return lastStop > maxChars * 0.4 ? cut.slice(0, lastStop + 1) : `${cut.trimEnd()}…`;
}
