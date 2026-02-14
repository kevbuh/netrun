/**
 * Captions Manager — real-time transcription via whisper.cpp binary.
 * Replaces the Python WebSocket captions endpoint.
 */
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const NOISE_PATTERNS = new Set([
  '[BLANK_AUDIO]', '[silence]', '[Music]', '[music]',
  '[Applause]', '[applause]', '[Laughter]', '[laughter]',
  '[ Silence ]', '(silence)', '...', '[MUSIC]',
  '[NO SPEECH]', '[no speech]', '[inaudible]',
]);

/**
 * Convert raw float32 PCM bytes to a 16-bit WAV file.
 * Port of Python _write_pcm_wav from app.py.
 */
function writePcmWav(pcmBuffer: Buffer, sampleRate: number, wavPath: string): void {
  const nFloats = pcmBuffer.length / 4;
  const int16Buf = Buffer.alloc(nFloats * 2);
  for (let i = 0; i < nFloats; i++) {
    const f = pcmBuffer.readFloatLE(i * 4);
    const clamped = Math.max(-32768, Math.min(32767, Math.round(f * 32767)));
    int16Buf.writeInt16LE(clamped, i * 2);
  }
  const dataLen = int16Buf.length;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLen, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);       // fmt chunk size
  header.writeUInt16LE(1, 20);        // PCM format
  header.writeUInt16LE(1, 22);        // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32);        // block align
  header.writeUInt16LE(16, 34);       // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(dataLen, 40);
  fs.writeFileSync(wavPath, Buffer.concat([header, int16Buf]));
}

/**
 * Find the whisper.cpp binary (whisper-cli or main).
 * Looks in PATH and common install locations.
 */
function findWhisperBinary(): string | null {
  const candidates = ['whisper-cli', 'whisper', 'main'];
  for (const name of candidates) {
    try {
      const { execFileSync } = require('child_process');
      execFileSync('which', [name], { encoding: 'utf-8' });
      return name;
    } catch { /* not found */ }
  }
  // Check common whisper.cpp build locations
  const homeDir = os.homedir();
  const commonPaths = [
    path.join(homeDir, 'whisper.cpp', 'main'),
    path.join(homeDir, 'whisper.cpp', 'build', 'bin', 'main'),
    '/usr/local/bin/whisper-cli',
  ];
  for (const p of commonPaths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * Find the whisper model file.
 */
function findWhisperModel(): string | null {
  const homeDir = os.homedir();
  const candidates = [
    path.join(homeDir, 'whisper.cpp', 'models', 'ggml-tiny.bin'),
    path.join(homeDir, '.cache', 'whisper', 'ggml-tiny.bin'),
    '/usr/local/share/whisper/ggml-tiny.bin',
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

let _whisperBinary: string | null = null;
let _whisperModel: string | null = null;

export function transcribeChunk(pcmBuffer: Buffer, sampleRate: number): Promise<string | null> {
  return new Promise((resolve) => {
    if (!_whisperBinary) _whisperBinary = findWhisperBinary();
    if (!_whisperModel) _whisperModel = findWhisperModel();

    if (!_whisperBinary || !_whisperModel) {
      resolve(null);
      return;
    }

    const tmpWav = path.join(os.tmpdir(), `cc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.wav`);
    try {
      writePcmWav(pcmBuffer, sampleRate, tmpWav);
    } catch {
      resolve(null);
      return;
    }

    execFile(_whisperBinary!, ['-m', _whisperModel!, '-f', tmpWav, '--no-timestamps', '-nt'], {
      timeout: 10_000,
    }, (err, stdout) => {
      try { fs.unlinkSync(tmpWav); } catch { /* ignore */ }
      if (err) { resolve(null); return; }
      const text = stdout.trim();
      if (!text || NOISE_PATTERNS.has(text)) { resolve(null); return; }
      resolve(text);
    });
  });
}
