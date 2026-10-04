import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * Worker tests must never touch the real runtime directories (which are in use
 * by a live pipeline), so every suite gets a throwaway scratch directory.
 */
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'matchcast-test-'));
process.env.TTS_DIR = path.join(scratch, 'tts');
process.env.FRAMES_DIR = path.join(scratch, 'frames');
process.env.PREVIEW_DIR = path.join(scratch, 'preview');
process.env.REPLAY_DIR = path.join(scratch, 'replay');
process.env.FRAME_TIMEOUT = '1000';
fs.mkdirSync(process.env.TTS_DIR, { recursive: true });
fs.mkdirSync(process.env.FRAMES_DIR, { recursive: true });
fs.mkdirSync(process.env.PREVIEW_DIR, { recursive: true });
fs.mkdirSync(process.env.REPLAY_DIR, { recursive: true });
