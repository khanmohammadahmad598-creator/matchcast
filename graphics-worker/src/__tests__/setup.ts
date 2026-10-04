import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Keep tests away from the live runtime directories.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'matchcast-gfx-test-'));
process.env.FRAMES_DIR = path.join(scratch, 'frames');
fs.mkdirSync(process.env.FRAMES_DIR, { recursive: true });
