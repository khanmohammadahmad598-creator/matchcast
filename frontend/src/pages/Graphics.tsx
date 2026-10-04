import { useRef, useState } from 'react';
import { api, endpoints } from '../lib/api';
import { useStore } from '../state/store';
import { Card, Empty, Field, Select, Slider, Toggle } from '../components/ui';
import type { GraphicsSettings } from '@matchcast/shared';

export function GraphicsPage() {
  const { graphics, templates, patch } = useStore();
  const [flashTitle, setFlashTitle] = useState('REPLAY');
  const [flashSubtitle, setFlashSubtitle] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  if (!graphics) return <Empty>Loading graphics settings…</Empty>;

  async function save(next: Partial<GraphicsSettings>) {
    const merged = { ...graphics, ...next } as GraphicsSettings;
    patch('graphics', merged);
    await api(endpoints.graphicsSettings, { method: 'PUT', body: merged });
  }

  async function upload(file: File, prefix: string) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('prefix', prefix);
      const token = localStorage.getItem('matchcast_token');
      const res = await fetch(`${endpoints.graphicsUpload}`, {
        method: 'POST',
        headers: token ? { authorization: `Bearer ${token}` } : undefined,
        body: form,
      });
      const json = (await res.json()) as { url?: string; error?: string };
      if (!res.ok) throw new Error(json.error ?? 'Upload failed');
      if (prefix === 'sponsor') await save({ sponsorLogoUrl: json.url, showSponsorBanner: true });
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-100">Graphics</h1>
        <p className="text-sm text-slate-500">Scoreboard templates, colours, sponsor banner and lower thirds</p>
      </div>

      <Card title="Templates" subtitle="Rendered live by the graphics worker">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((t) => {
            const active = graphics.templateId === t.id;
            return (
              <button
                key={t.id}
                onClick={() => void api(endpoints.graphicsApply(t.id), { method: 'POST' }).then(() => patch('graphics', { ...graphics, ...t.config, templateId: t.id }))}
                className={`rounded-xl border p-4 text-left transition ${
                  active ? 'border-accent/60 bg-accent/10' : 'border-white/5 bg-ink-700/40 hover:bg-ink-700'
                }`}
              >
                <div className="mb-3 h-20 rounded-lg" style={{ background: `linear-gradient(135deg, ${t.previewColor}33, #0b1120)` }}>
                  <div className="flex h-full items-end gap-2 p-2">
                    <span className="rounded px-2 py-1 text-[10px] font-bold text-white" style={{ background: t.previewColor }}>
                      LIVE
                    </span>
                    <span className="rounded bg-black/60 px-2 py-1 text-[10px] text-white">IND 125/3 (18.4)</span>
                  </div>
                </div>
                <p className="text-sm font-medium text-slate-100">{t.name}</p>
                <p className="mt-0.5 text-xs text-slate-500">{t.description}</p>
              </button>
            );
          })}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Appearance">
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <ColorField label="Accent" value={graphics.accentColor} onChange={(v) => void save({ accentColor: v })} />
              <ColorField label="Background" value={graphics.backgroundColor} onChange={(v) => void save({ backgroundColor: v })} />
              <ColorField label="Text" value={graphics.textColor} onChange={(v) => void save({ textColor: v })} />
            </div>
            <Select
              label="Scoreboard position"
              value={graphics.scoreboardPosition}
              options={[
                { value: 'bottom-left', label: 'Bottom left' },
                { value: 'bottom-right', label: 'Bottom right' },
                { value: 'top-left', label: 'Top left' },
                { value: 'top-right', label: 'Top right' },
              ]}
              onChange={(v) => void save({ scoreboardPosition: v })}
            />
            <Slider label="Opacity" value={graphics.opacity} min={0.2} max={1} step={0.02} onChange={(v) => void save({ opacity: v })} format={(v) => `${Math.round(v * 100)}%`} />
            <Slider
              label="Overlay render FPS"
              value={graphics.overlayFps}
              min={5}
              max={30}
              onChange={(v) => void save({ overlayFps: v })}
              format={(v) => `${v} fps`}
            />
            <Toggle label="LIVE badge" checked={graphics.showLiveBadge} onChange={(v) => void save({ showLiveBadge: v })} />
            <Toggle label="Intro card" checked={graphics.introVisible} onChange={(v) => void save({ introVisible: v })} />
            <Toggle label="Outro card" checked={graphics.outroVisible} onChange={(v) => void save({ outroVisible: v })} />
          </div>
        </Card>

        <Card title="Sponsor & lower third">
          <div className="space-y-4">
            <Toggle label="Sponsor banner" checked={graphics.showSponsorBanner} onChange={(v) => void save({ showSponsorBanner: v })} />
            <Field label="Sponsor text" value={graphics.sponsorText ?? ''} onChange={(v) => void save({ sponsorText: v })} placeholder="Presented by…" />
            <div>
              <p className="label">Sponsor logo</p>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void upload(file, 'sponsor');
                }}
              />
              <button className="btn-ghost" disabled={uploading} onClick={() => fileRef.current?.click()}>
                {uploading ? 'Uploading…' : 'Upload logo (PNG/JPG/SVG, max 4MB)'}
              </button>
              {graphics.sponsorLogoUrl && <p className="mt-2 truncate text-xs text-slate-500">{graphics.sponsorLogoUrl}</p>}
            </div>

            <hr className="border-white/5" />

            <Toggle label="Show lower third" checked={graphics.lowerThirdVisible} onChange={(v) => void save({ lowerThirdVisible: v })} />
            <Field label="Lower third title" value={graphics.lowerThirdTitle ?? ''} onChange={(v) => void save({ lowerThirdTitle: v })} placeholder="BREAKING NEWS" />
            <Field label="Lower third subtitle" value={graphics.lowerThirdSubtitle ?? ''} onChange={(v) => void save({ lowerThirdSubtitle: v })} />
          </div>
        </Card>
      </div>

      <Card title="Flash a graphic" subtitle="Shows a big centred card for a few seconds">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[200px] flex-1">
            <Field label="Title" value={flashTitle} onChange={setFlashTitle} />
          </div>
          <div className="min-w-[200px] flex-1">
            <Field label="Subtitle" value={flashSubtitle} onChange={setFlashSubtitle} />
          </div>
          <button
            className="btn-primary"
            onClick={() => void api(endpoints.graphicsFlash, { method: 'POST', body: { title: flashTitle, subtitle: flashSubtitle, ms: 5000 } })}
          >
            Show for 5s
          </button>
        </div>
      </Card>
    </div>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <div className="flex items-center gap-2">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-9 w-10 rounded border border-white/10 bg-transparent" />
        <span className="font-mono text-xs text-slate-300">{value}</span>
      </div>
    </label>
  );
}
