#!/usr/bin/env bash
#
# Generate the local demo feed used by DEMO mode.
#
# The output is 100% synthetic and generated on your own machine: a stylised
# cricket field with a moving ball, drifting fielders, crowd ambience and a
# "MATCHCAST AUTHORIZED DEMO FEED" burn-in. No third-party or broadcast
# material is used, so it is always safe to stream (see docs/COMPLIANCE.md).
#
# Usage: bash scripts/make-demo-asset.sh [seconds] [output-path]
set -euo pipefail

SECONDS_LEN="${1:-60}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${2:-$ROOT/demo-assets/demo-match.mp4}"

FONT_HINT=""
if [ -f /usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf ]; then
  FONT_HINT=":fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
fi

FIELD_FILTER="drawbox=x=190:y=150:w=900:h=470:color=0x9c7b46:t=fill"
FIELD_FILTER="$FIELD_FILTER,drawbox=x=230:y=190:w=820:h=390:color=0x1f8f3f:t=fill"
FIELD_FILTER="$FIELD_FILTER,drawbox=x=250:y=210:w=780:h=350:color=0x2aa04a:t=fill"
FIELD_FILTER="$FIELD_FILTER,drawbox=x=600:y=200:w=80:h=370:color=0x8a6a3a:t=fill"

# Two batters, a bowler and a couple of fielders drifting around the pitch.
PLAYER_FILTER="drawbox=x=430:y=300:w=24:h=24:color=0xffdd66:t=fill"
PLAYER_FILTER="$PLAYER_FILTER,drawbox=x=850:y=430:w=24:h=24:color=0xffdd66:t=fill"
PLAYER_FILTER="$PLAYER_FILTER,drawbox=x='300+sin(t*0.7)*45':y='250+cos(t*0.5)*35':w=24:h=24:color=0xffdd66:t=fill"
PLAYER_FILTER="$PLAYER_FILTER,drawbox=x='950+cos(t*0.6)*45':y='320+sin(t*0.8)*35':w=24:h=24:color=0xffdd66:t=fill"
PLAYER_FILTER="$PLAYER_FILTER,drawbox=x='640+sin(t*0.35)*260':y='600+cos(t*0.4)*40':w=24:h=24:color=0xffdd66:t=fill"

# The ball: visible motion keeps the encoder honest about the bitrate target.
BALL_FILTER="drawbox=x='(w/2)-9+sin(t*1.1)*360':y='(h/2)-9+cos(t*0.9)*150':w=18:h=18:color=white:t=fill"

TEXT_FILTER="drawtext=text='MATCHCAST AUTHORIZED DEMO FEED':fontcolor=white@0.80:fontsize=26:x=40:y=36$FONT_HINT"
TEXT_FILTER="$TEXT_FILTER,drawtext=text='SYNTHETIC TEST SIGNAL - NOT A REAL BROADCAST':fontcolor=white@0.55:fontsize=18:x=40:y=70$FONT_HINT"

VIDEO_FILTER="$FIELD_FILTER,$PLAYER_FILTER,$BALL_FILTER,noise=alls=4:allf=t+u,$TEXT_FILTER"

# Crowd ambience: band-limited pink noise with a slow swell.
AUDIO_FILTER="lowpass=f=1500,highpass=f=150,tremolo=f=0.12:d=0.25,volume=0.16"

echo "[demo-asset] Rendering ${SECONDS_LEN}s of synthetic match footage..."
mkdir -p "$(dirname "$OUT")"

ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "gradients=s=1280x720:r=30:c0=0x237a3d:c1=0x0b3f1c:c2=0x1a5c2e:x0=0:y0=0:x1=1280:y1=720:nb_colors=3:speed=0.008:d=$SECONDS_LEN" \
  -f lavfi -i "anoisesrc=r=48000:c=pink:a=0.6:d=$SECONDS_LEN" \
  -filter:v "$VIDEO_FILTER" \
  -filter:a "$AUDIO_FILTER" \
  -c:v libx264 -preset veryfast -profile:v high -pix_fmt yuv420p -b:v 3000k -g 60 \
  -c:a aac -b:a 128k -ar 48000 -ac 2 \
  -shortest -movflags +faststart "$OUT"

SIZE="$(du -h "$OUT" | cut -f1)"
echo "[demo-asset] Done: $SIZE -> $OUT"
