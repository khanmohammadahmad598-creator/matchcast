import { useEffect, useRef } from 'react';
import Hls from 'hls.js';

const PREVIEW_TOKEN = import.meta.env.VITE_PREVIEW_TOKEN ?? 'preview';

/**
 * Low-latency HLS preview of the exact frames the encoder is producing.
 * Falls back to native HLS on Safari when hls.js is unsupported.
 */
export function VideoPreview({ className = '' }: { className?: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const src = `/api/preview/${PREVIEW_TOKEN}/index.m3u8`;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (Hls.isSupported()) {
      const hls = new Hls({ lowLatencyMode: true, liveDurationInfinity: true, backBufferLength: 4 });
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (data.fatal) {
          // The preview only exists while the pipeline is running; retry gently.
          setTimeout(() => hls.loadSource(src), 3000);
        }
      });
      return () => hls.destroy();
    }
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
    }
    return undefined;
  }, [src]);

  return (
    <div className={`relative overflow-hidden rounded-xl border border-white/5 bg-black ${className}`}>
      <video ref={videoRef} className="h-full w-full object-contain" autoPlay muted playsInline controls />
      <span className="pointer-events-none absolute left-3 top-3 rounded bg-black/60 px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-slate-200">
        Program preview
      </span>
    </div>
  );
}
