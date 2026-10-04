-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'OPERATOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('SCHEDULED', 'LIVE', 'INNINGS_BREAK', 'COMPLETED', 'ABANDONED', 'PAUSED');

-- CreateEnum
CREATE TYPE "MatchFormat" AS ENUM ('T20', 'ODI', 'TEST', 'T10', 'HUNDRED', 'CUSTOM');

-- CreateEnum
CREATE TYPE "PlayerRole" AS ENUM ('BAT', 'BOWL', 'AR', 'WK');

-- CreateEnum
CREATE TYPE "ExtraType" AS ENUM ('WD', 'NB', 'LB', 'B', 'P');

-- CreateEnum
CREATE TYPE "DismissalKind" AS ENUM ('BOWLED', 'CAUGHT', 'LBW', 'RUN_OUT', 'STUMPED', 'HIT_WICKET', 'CAUGHT_AND_BOWLED', 'RETIRED_OUT', 'OTHER');

-- CreateEnum
CREATE TYPE "MatchEventType" AS ENUM ('BALL', 'FOUR', 'SIX', 'WICKET', 'MILESTONE', 'OVER_END', 'INNINGS_END', 'MATCH_END', 'MATCH_START', 'CUSTOM');

-- CreateEnum
CREATE TYPE "TtsStatus" AS ENUM ('PENDING', 'SYNTHESISING', 'READY', 'PLAYED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "InputKind" AS ENUM ('rtmp', 'srt', 'hls', 'file', 'device', 'demo');

-- CreateEnum
CREATE TYPE "SessionEndReason" AS ENUM ('STOPPED', 'CRASHED', 'INPUT_LOST', 'OUTPUT_LOST', 'RESTARTED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'OPERATOR',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" VARCHAR(12) NOT NULL,
    "logoUrl" TEXT,
    "primaryColor" TEXT,
    "secondaryColor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "players" (
    "id" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "role" "PlayerRole" NOT NULL DEFAULT 'BAT',
    "jerseyNumber" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matches" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "tournament" TEXT,
    "venue" TEXT,
    "format" "MatchFormat" NOT NULL DEFAULT 'T20',
    "oversPerInnings" INTEGER,
    "startsAt" TIMESTAMP(3),
    "status" "MatchStatus" NOT NULL DEFAULT 'SCHEDULED',
    "teamAId" UUID NOT NULL,
    "teamBId" UUID NOT NULL,
    "battingTeamId" UUID,
    "bowlingTeamId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "innings" (
    "id" UUID NOT NULL,
    "matchId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "battingTeamId" UUID NOT NULL,
    "bowlingTeamId" UUID NOT NULL,
    "runs" INTEGER NOT NULL DEFAULT 0,
    "wickets" INTEGER NOT NULL DEFAULT 0,
    "legalBalls" INTEGER NOT NULL DEFAULT 0,
    "wides" INTEGER NOT NULL DEFAULT 0,
    "noBalls" INTEGER NOT NULL DEFAULT 0,
    "byes" INTEGER NOT NULL DEFAULT 0,
    "legByes" INTEGER NOT NULL DEFAULT 0,
    "penalties" INTEGER NOT NULL DEFAULT 0,
    "target" INTEGER,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "strikerId" UUID,
    "nonStrikerId" UUID,
    "bowlerId" UUID,
    "strikerRuns" INTEGER NOT NULL DEFAULT 0,
    "strikerBalls" INTEGER NOT NULL DEFAULT 0,
    "strikerFours" INTEGER NOT NULL DEFAULT 0,
    "strikerSixes" INTEGER NOT NULL DEFAULT 0,
    "nonStrikerRuns" INTEGER NOT NULL DEFAULT 0,
    "nonStrikerBalls" INTEGER NOT NULL DEFAULT 0,
    "nonStrikerFours" INTEGER NOT NULL DEFAULT 0,
    "nonStrikerSixes" INTEGER NOT NULL DEFAULT 0,
    "bowlerRuns" INTEGER NOT NULL DEFAULT 0,
    "bowlerBalls" INTEGER NOT NULL DEFAULT 0,
    "bowlerWickets" INTEGER NOT NULL DEFAULT 0,
    "bowlerMaidens" INTEGER NOT NULL DEFAULT 0,
    "partnershipRuns" INTEGER NOT NULL DEFAULT 0,
    "partnershipBalls" INTEGER NOT NULL DEFAULT 0,
    "freeHit" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "innings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "balls" (
    "id" UUID NOT NULL,
    "inningsId" UUID NOT NULL,
    "over" INTEGER NOT NULL,
    "ballInOver" INTEGER NOT NULL,
    "runs" INTEGER NOT NULL DEFAULT 0,
    "batterRuns" INTEGER NOT NULL DEFAULT 0,
    "extraType" "ExtraType",
    "isLegal" BOOLEAN NOT NULL DEFAULT true,
    "isWicket" BOOLEAN NOT NULL DEFAULT false,
    "wicketKind" "DismissalKind",
    "batterOutId" UUID,
    "strikerId" UUID,
    "nonStrikerId" UUID,
    "bowlerId" UUID,
    "label" VARCHAR(8) NOT NULL,
    "teamRuns" INTEGER NOT NULL DEFAULT 0,
    "teamWickets" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "balls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "score_events" (
    "id" UUID NOT NULL,
    "matchId" UUID NOT NULL,
    "type" "MatchEventType" NOT NULL,
    "headline" TEXT NOT NULL,
    "facts" JSONB NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 50,
    "consumed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "score_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commentary" (
    "id" UUID NOT NULL,
    "matchId" UUID NOT NULL,
    "language" VARCHAR(8) NOT NULL,
    "style" VARCHAR(24) NOT NULL,
    "text" TEXT NOT NULL,
    "eventType" "MatchEventType",
    "provider" TEXT NOT NULL DEFAULT 'rule-based',
    "spoken" BOOLEAN NOT NULL DEFAULT false,
    "ttsStatus" "TtsStatus" NOT NULL DEFAULT 'PENDING',
    "audioUrl" TEXT,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commentary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tts_audio" (
    "id" UUID NOT NULL,
    "commentaryId" UUID,
    "provider" TEXT NOT NULL,
    "voice" TEXT,
    "language" VARCHAR(8),
    "text" TEXT NOT NULL,
    "cacheKey" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "format" VARCHAR(8) NOT NULL,
    "durationMs" INTEGER,
    "sizeBytes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tts_audio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stream_sessions" (
    "id" UUID NOT NULL,
    "matchId" UUID,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "inputKind" "InputKind" NOT NULL,
    "inputUrl" TEXT NOT NULL,
    "outputTarget" TEXT NOT NULL,
    "resolution" VARCHAR(8) NOT NULL,
    "fps" INTEGER NOT NULL,
    "videoBitrateKbps" INTEGER NOT NULL,
    "audioBitrateKbps" INTEGER NOT NULL,
    "reconnectCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "endReason" "SessionEndReason",
    "bytesSent" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stream_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "graphics_templates" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "previewColor" TEXT NOT NULL DEFAULT '#00d09c',
    "config" JSONB NOT NULL,
    "isBuiltIn" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "graphics_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_logs" (
    "id" UUID NOT NULL,
    "level" VARCHAR(8) NOT NULL,
    "source" VARCHAR(24) NOT NULL,
    "message" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "replay_clips" (
    "id" UUID NOT NULL,
    "matchId" UUID NOT NULL,
    "eventType" "MatchEventType" NOT NULL,
    "filePath" TEXT NOT NULL,
    "durationSeconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "inserted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "replay_clips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "authorized_sources" (
    "id" UUID NOT NULL,
    "kind" "InputKind" NOT NULL,
    "urlPattern" TEXT NOT NULL,
    "rightsNote" TEXT,
    "attestedById" UUID,
    "attestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "authorized_sources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "innings_matchId_number_key" ON "innings"("matchId", "number");

-- CreateIndex
CREATE INDEX "balls_inningsId_createdAt_idx" ON "balls"("inningsId", "createdAt");

-- CreateIndex
CREATE INDEX "score_events_matchId_createdAt_idx" ON "score_events"("matchId", "createdAt");

-- CreateIndex
CREATE INDEX "commentary_matchId_createdAt_idx" ON "commentary"("matchId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "tts_audio_cacheKey_key" ON "tts_audio"("cacheKey");

-- CreateIndex
CREATE INDEX "tts_audio_createdAt_idx" ON "tts_audio"("createdAt");

-- CreateIndex
CREATE INDEX "stream_sessions_startedAt_idx" ON "stream_sessions"("startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "graphics_templates_name_key" ON "graphics_templates"("name");

-- CreateIndex
CREATE INDEX "system_logs_createdAt_idx" ON "system_logs"("createdAt");

-- CreateIndex
CREATE INDEX "system_logs_level_idx" ON "system_logs"("level");

-- CreateIndex
CREATE INDEX "replay_clips_matchId_createdAt_idx" ON "replay_clips"("matchId", "createdAt");

-- AddForeignKey
ALTER TABLE "players" ADD CONSTRAINT "players_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_teamAId_fkey" FOREIGN KEY ("teamAId") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_teamBId_fkey" FOREIGN KEY ("teamBId") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "innings" ADD CONSTRAINT "innings_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "balls" ADD CONSTRAINT "balls_inningsId_fkey" FOREIGN KEY ("inningsId") REFERENCES "innings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_events" ADD CONSTRAINT "score_events_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commentary" ADD CONSTRAINT "commentary_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stream_sessions" ADD CONSTRAINT "stream_sessions_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replay_clips" ADD CONSTRAINT "replay_clips_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authorized_sources" ADD CONSTRAINT "authorized_sources_attestedById_fkey" FOREIGN KEY ("attestedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
