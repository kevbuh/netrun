/**
 * Captions Manager — real-time transcription via Parakeet TDT.
 * Sends PCM audio chunks to the persistent parakeet-manager service.
 */
import { parakeetManager } from './parakeet-manager.js';

const NOISE_PATTERNS = new Set([
  '[BLANK_AUDIO]', '[silence]', '[Music]', '[music]',
  '[Applause]', '[applause]', '[Laughter]', '[laughter]',
  '[ Silence ]', '(silence)', '...', '[MUSIC]',
  '[NO SPEECH]', '[no speech]', '[inaudible]',
]);

export async function transcribeChunk(pcmBuffer: Buffer, sampleRate: number): Promise<string | null> {
  try {
    const pcmBase64 = pcmBuffer.toString('base64');
    const result = await parakeetManager.transcribePcm(pcmBase64, sampleRate);
    const text = result.text?.trim();
    if (!text || NOISE_PATTERNS.has(text)) return null;
    return text;
  } catch {
    return null;
  }
}
