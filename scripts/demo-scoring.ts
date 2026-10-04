/**
 * Demo mode driver: pushes realistic cricket deliveries into the running
 * platform so the whole chain can be exercised without a live scorer:
 *
 *   ball -> backend -> websocket -> graphics + AI commentary -> TTS -> audio
 *
 * Usage:
 *   npx tsx scripts/demo-scoring.ts --match <matchId> [--balls 40] [--interval 3500]
 *   npx tsx scripts/demo-scoring.ts --provider        # use the public /api/match/update contract
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

// When this script is run from the repo root there is no .env there, so pull
// the backend environment in explicitly (credentials + SCORING_API_KEY).
for (const candidate of [path.resolve(process.cwd(), 'backend/.env')]) {
  if (!process.env.SCORING_API_KEY && fs.existsSync(candidate)) {
    for (const line of fs.readFileSync(candidate, 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (!m) continue;
      const value = m[2]!.replace(/^["']|["']$/g, '');
      if (process.env[m[1]!] === undefined) process.env[m[1]!] = value;
    }
  }
}

const BACKEND = process.env.BACKEND_URL ?? process.env.API_URL ?? 'http://127.0.0.1:4000';
const EMAIL = process.env.DEFAULT_ADMIN_EMAIL ?? 'admin@matchcast.local';
const PASSWORD = process.env.DEFAULT_ADMIN_PASSWORD ?? 'ChangeMeNow123!';
const SCORING_KEY = process.env.SCORING_API_KEY ?? 'dev-local-scoring-api-key';

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const useProvider = flag('provider');
const totalBalls = Number(arg('balls', '40') ?? 40);
const intervalMs = Number(arg('interval', arg('delay', '3500')) ?? 3500);

/** Weighted delivery mix - roughly T20-shaped. */
const DELIVERIES: Array<{ runs: number; weight: number; extra?: string }> = [
  { runs: 0, weight: 30 },
  { runs: 1, weight: 28 },
  { runs: 2, weight: 10 },
  { runs: 3, weight: 3 },
  { runs: 4, weight: 12 },
  { runs: 6, weight: 7 },
  { runs: 1, weight: 5, extra: 'WD' },
  { runs: 1, weight: 3, extra: 'NB' },
  { runs: 0, weight: 2, extra: 'WICKET' },
];

function pickDelivery(): { runs: number; extra?: string } {
  const total = DELIVERIES.reduce((s, d) => s + d.weight, 0);
  let r = Math.random() * total;
  for (const d of DELIVERIES) {
    r -= d.weight;
    if (r <= 0) return { runs: d.runs, extra: d.extra };
  }
  return { runs: 0 };
}

async function main(): Promise<void> {
  console.log(`[demo] Backend: ${BACKEND}`);

  const loginRes = await fetch(`${BACKEND}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!loginRes.ok) throw new Error(`Login failed: ${loginRes.status}`);
  const { token } = (await loginRes.json()) as { token: string };

  const matchesRes = await fetch(`${BACKEND}/api/matches`, { headers: { authorization: `Bearer ${token}` } });
  const { matches } = (await matchesRes.json()) as { matches: Array<{ id: string; title: string; status: string }> };
  const matchId = arg('match') ?? matches[0]?.id;
  if (!matchId) throw new Error('No match found. Run `npm run db:seed` first.');
  console.log(`[demo] Match: ${matchId} (${matches.find((m) => m.id === matchId)?.title ?? ''})`);

  // Make sure the match is live.
  const stateRes = await fetch(`${BACKEND}/api/match/${matchId}/state`, { headers: { authorization: `Bearer ${token}` } });
  const state = (await stateRes.json()) as { snapshot: { status: string } | null };
  if (state.snapshot?.status === 'SCHEDULED') {
    await fetch(`${BACKEND}/api/match/${matchId}/start`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}' });
    console.log('[demo] Match started');
  }

  // Running totals for the provider-style contract - seeded from the live
  // snapshot so the server never receives a value that goes backwards.
  const snap = (state.snapshot ?? null) as {
    runs?: number;
    wickets?: number;
    legalBalls?: number;
    striker?: { name?: string } | null;
    bowler?: { name?: string } | null;
  } | null;
  let runs = snap?.runs ?? 0;
  let wickets = snap?.wickets ?? 0;
  let legalBalls = snap?.legalBalls ?? 0;
  let lastStriker = snap?.striker?.name ?? 'R Sharma';
  let lastBowler = snap?.bowler?.name ?? 'M Starc';

  console.log(`[demo] Sending ${totalBalls} deliveries every ${intervalMs}ms (mode: ${useProvider ? 'provider API' : 'ball API'})\n`);

  for (let i = 0; i < totalBalls; i++) {
    const d = pickDelivery();
    const isWicket = d.extra === 'WICKET';

    if (useProvider) {
      runs += d.runs;
      if (isWicket) wickets += 1;
      if (!d.extra) legalBalls += 1;
      const overs = `${Math.floor(legalBalls / 6)}.${legalBalls % 6}`;
      const body = {
        matchId,
        team: 'India',
        runs,
        wickets,
        overs,
        striker: lastStriker,
        non_striker: 'S Gill',
        bowler: lastBowler,
      };
      const res = await fetch(`${BACKEND}/api/match/update`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-scoring-api-key': SCORING_KEY },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string; events?: Array<{ type: string }>; snapshot?: { runs: number; wickets: number; overs: number } };
      if (!res.ok) {
        console.error(`[demo] update failed: ${json.error ?? res.status}`);
      } else {
        const s = json.snapshot;
        console.log(
          `[demo] ${String(i + 1).padStart(2)} ${d.runs}${isWicket ? ' W' : d.extra ? ` ${d.extra}` : ''} -> ` +
            `${s?.runs}/${s?.wickets} (${s?.overs}) events=${(json.events ?? []).map((e) => e.type).join(',') || '-'}`,
        );
      }
    } else {
      const body: Record<string, unknown> = { runs: d.runs, isWicket };
      if (d.extra && d.extra !== 'WICKET') body.extraType = d.extra;
      const path = isWicket ? 'wicket' : 'ball';
      const res = await fetch(`${BACKEND}/api/match/${matchId}/${path}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(isWicket ? { wicketKind: 'CAUGHT' } : body),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string; events?: Array<{ type: string }>; snapshot?: { runs: number; wickets: number; overs: number } };
      if (!res.ok) console.error(`[demo] ball failed: ${json.error ?? res.status}`);
      else {
        const s = json.snapshot;
        console.log(
          `[demo] ${String(i + 1).padStart(2)} ${d.runs}${isWicket ? ' W' : d.extra ? ` ${d.extra}` : ''} -> ` +
            `${s?.runs}/${s?.wickets} (${s?.overs}) events=${(json.events ?? []).map((e) => e.type).join(',') || '-'}`,
        );
      }
    }

    // Rotate the strike/bowler occasionally so the commentary has variety.
    if (i % 7 === 6) lastStriker = lastStriker === 'R Sharma' ? 'V Kohli' : 'R Sharma';
    if (i % 12 === 11) lastBowler = lastBowler === 'M Starc' ? 'A Zampa' : 'M Starc';

    await new Promise((r) => setTimeout(r, intervalMs));
  }

  console.log('\n[demo] Done. Check the dashboard: commentary history, scoreboard overlay and logs.');
}

main().catch((err) => {
  console.error('[demo] Fatal:', err);
  process.exit(1);
});
