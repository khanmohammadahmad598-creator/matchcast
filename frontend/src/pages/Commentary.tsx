import { useState } from 'react';
import { api, endpoints } from '../lib/api';
import { useStore } from '../state/store';
import { Card, Empty, Select, Slider, Toggle } from '../components/ui';
import type { AiSettings, TtsSettings } from '@matchcast/shared';

const LANGS = [
  { value: 'hi', label: 'Hindi' },
  { value: 'hinglish', label: 'Hinglish' },
  { value: 'en', label: 'English' },
] as const;

const STYLES = [
  { value: 'professional', label: 'Professional' },
  { value: 'excited', label: 'Excited' },
  { value: 'calm', label: 'Calm' },
  { value: 'fast', label: 'Fast-paced' },
  { value: 'expert', label: 'Cricket expert' },
] as const;

const EVENT_TYPES = ['FOUR', 'SIX', 'WICKET', 'MILESTONE', 'BALL', 'OVER_END', 'INNINGS_END'] as const;

export function Commentary() {
  const { ai, tts, commentary, patch } = useStore();
  const [manual, setManual] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!ai || !tts) return <Empty>Loading commentary settings…</Empty>;

  async function saveAi(next: Partial<AiSettings>) {
    const merged = { ...ai, ...next } as AiSettings;
    patch('ai', merged);
    await api(endpoints.commentarySettings, { method: 'PUT', body: merged });
  }

  async function saveTts(next: Partial<TtsSettings>) {
    const merged = { ...tts, ...next } as TtsSettings;
    patch('tts', merged);
    await api(endpoints.ttsSettings, { method: 'PUT', body: merged });
  }

  async function speak() {
    if (!manual.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      await api(endpoints.commentarySpeak, { method: 'POST', body: { text: manual } });
      setMessage('Sent to the TTS queue');
      setManual('');
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const lines = commentary.slice(-60).reverse();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-100">AI Commentary</h1>
        <p className="text-sm text-slate-500">Language, style, cooldown and voice settings for the live commentator</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Commentary engine" subtitle="What the AI says and when">
          <div className="space-y-4">
            <Toggle
              label="Enable AI commentary"
              description="Turn off to keep the broadcast silent"
              checked={ai.enabled}
              onChange={(v) => void saveAi({ enabled: v })}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Select label="Language" value={ai.language} options={[...LANGS]} onChange={(v) => void saveAi({ language: v })} />
              <Select label="Style" value={ai.style} options={[...STYLES]} onChange={(v) => void saveAi({ style: v })} />
            </div>
            <Slider
              label="Cooldown between lines"
              value={ai.cooldownSeconds}
              min={0}
              max={60}
              onChange={(v) => void saveAi({ cooldownSeconds: v })}
              format={(v) => `${v}s`}
            />
            <Slider
              label="Minimum gap"
              value={ai.minGapSeconds}
              min={0}
              max={30}
              onChange={(v) => void saveAi({ minGapSeconds: v })}
              format={(v) => `${v}s`}
            />
            <Slider
              label="Verbosity"
              value={ai.verbosity}
              min={0}
              max={1}
              step={0.05}
              onChange={(v) => void saveAi({ verbosity: v })}
              format={(v) => v.toFixed(2)}
            />
            <Slider
              label="Max characters per line"
              value={ai.maxChars}
              min={60}
              max={300}
              step={10}
              onChange={(v) => void saveAi({ maxChars: v })}
            />
            <Slider
              label="Anti-repetition memory"
              value={ai.antiRepetitionWindow}
              min={0}
              max={60}
              onChange={(v) => void saveAi({ antiRepetitionWindow: v })}
              format={(v) => `${v} lines`}
            />
            <div>
              <p className="label">Speak on these events</p>
              <div className="flex flex-wrap gap-2">
                {EVENT_TYPES.map((type) => {
                  const active = ai.speakOnEventTypes.includes(type);
                  return (
                    <button
                      key={type}
                      onClick={() =>
                        void saveAi({
                          speakOnEventTypes: active
                            ? ai.speakOnEventTypes.filter((t) => t !== type)
                            : [...ai.speakOnEventTypes, type],
                        })
                      }
                      className={`chip border ${active ? 'border-accent/60 bg-accent/15 text-accent' : 'border-white/10 bg-white/5 text-slate-400'}`}
                    >
                      {type}
                    </button>
                  );
                })}
              </div>
            </div>
            <Select
              label="Provider"
              value={ai.provider}
              options={[
                { value: 'auto', label: 'Auto (best available)' },
                { value: 'openai', label: 'OpenAI' },
                { value: 'anthropic', label: 'Anthropic' },
                { value: 'gemini', label: 'Google Gemini' },
                { value: 'rule-based', label: 'Offline rule-based (no API)' },
              ]}
              onChange={(v) => void saveAi({ provider: v })}
            />
          </div>
        </Card>

        <Card title="Voice (TTS)" subtitle="How the commentary sounds">
          <div className="space-y-4">
            <Toggle
              label="Speak commentary"
              description="Disable to generate text only"
              checked={tts.enabled}
              onChange={(v) => void saveTts({ enabled: v })}
            />
            <Select
              label="Provider"
              value={tts.provider}
              options={[
                { value: 'auto', label: 'Auto (best available)' },
                { value: 'openai', label: 'OpenAI TTS' },
                { value: 'elevenlabs', label: 'ElevenLabs' },
                { value: 'google', label: 'Google Cloud TTS' },
                { value: 'mock', label: 'Offline tone (testing)' },
              ]}
              onChange={(v) => void saveTts({ provider: v })}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Select label="Language" value={tts.language} options={[...LANGS]} onChange={(v) => void saveTts({ language: v })} />
              <Select
                label="Voice gender"
                value={tts.gender}
                options={[
                  { value: 'male', label: 'Male' },
                  { value: 'female', label: 'Female' },
                  { value: 'neutral', label: 'Neutral' },
                ]}
                onChange={(v) => void saveTts({ gender: v })}
              />
            </div>
            <Slider
              label="Speaking speed"
              value={tts.speed}
              min={0.5}
              max={2}
              step={0.05}
              onChange={(v) => void saveTts({ speed: v })}
              format={(v) => `${v.toFixed(2)}x`}
            />
            <Slider
              label="Volume"
              value={tts.volume}
              min={0}
              max={1.5}
              step={0.05}
              onChange={(v) => void saveTts({ volume: v })}
              format={(v) => `${Math.round(v * 100)}%`}
            />
            <Slider
              label="Pitch"
              value={tts.pitch}
              min={-10}
              max={10}
              step={0.5}
              onChange={(v) => void saveTts({ pitch: v })}
              format={(v) => `${v > 0 ? '+' : ''}${v}`}
            />
            <Slider
              label="Max queue length"
              value={tts.maxQueue}
              min={1}
              max={20}
              onChange={(v) => void saveTts({ maxQueue: v })}
              format={(v) => `${v} lines`}
            />
            <div className="flex gap-2">
              <button className="btn-ghost" onClick={() => void api(endpoints.ttsClear, { method: 'POST' })}>
                Clear TTS queue
              </button>
            </div>
          </div>
        </Card>
      </div>

      <Card title="Manual line" subtitle="Speak something that is not tied to a scoring event">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[280px] flex-1">
            <label className="block">
              <span className="label">Text</span>
              <input className="input" value={manual} onChange={(e) => setManual(e.target.value)} placeholder="और ये शानदार चौका!" />
            </label>
          </div>
          <button className="btn-primary" disabled={busy} onClick={() => void speak()}>
            {busy ? 'Sending…' : 'Speak now'}
          </button>
        </div>
        {message && <p className="mt-2 text-xs text-slate-400">{message}</p>}
      </Card>

      <Card title="Commentary history" subtitle={`${commentary.length} lines this session`}>
        <div className="max-h-[520px] space-y-2 overflow-y-auto">
          {lines.length === 0 && <Empty>No commentary generated yet — score a four or six.</Empty>}
          {lines.map((c) => (
            <div key={c.id} className="flex items-start justify-between gap-3 rounded-lg border border-white/5 bg-ink-700/40 p-3">
              <div>
                <p className="text-sm text-slate-100">{c.text}</p>
                <p className="mt-1 text-[11px] text-slate-500">
                  {new Date(c.createdAt).toLocaleTimeString()} · {c.language} · {c.style} · {c.provider}
                  {c.eventType ? ` · ${c.eventType}` : ''}
                </p>
              </div>
              <span
                className={`chip shrink-0 ${
                  c.ttsStatus === 'PLAYED'
                    ? 'bg-accent/15 text-accent'
                    : c.ttsStatus === 'FAILED'
                      ? 'bg-danger/15 text-danger'
                      : 'bg-white/10 text-slate-400'
                }`}
              >
                {c.ttsStatus}
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
