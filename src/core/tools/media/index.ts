import { z } from 'zod';
import type { Tool, ToolResult } from '../types.js';
import { pythonManager } from '../../python/process-manager.js';
import { parakeetManager } from '../../parakeet-manager.js';

const transcribeParams = z.object({
  audioPath: z.string().describe('Path to the audio file to transcribe'),
});

export const mediaTranscribe: Tool<z.infer<typeof transcribeParams>, { text: string }> = {
  name: 'media-transcribe',
  description: 'Transcribe audio to text using Parakeet TDT.',
  category: 'media',
  access: ['agent', 'mcp', 'ui'],
  parameters: transcribeParams,
  async execute(input): Promise<ToolResult<{ text: string }>> {
    try {
      const result = await parakeetManager.transcribe(input.audioPath);
      if (!result.text) return { success: false, error: 'No speech detected' };
      return { success: true, data: { text: result.text } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};

const ttsParams = z.object({
  text: z.string().describe('Text to synthesize to speech'),
  voice: z.string().optional().describe('Voice name (default: af_heart)'),
});

export const mediaTts: Tool<z.infer<typeof ttsParams>, { audioPath: string }> = {
  name: 'media-tts',
  description: 'Convert text to speech audio.',
  category: 'media',
  access: ['agent', 'mcp', 'ui'],
  parameters: ttsParams,
  async execute(input): Promise<ToolResult<{ audioPath: string }>> {
    try {
      const result = await pythonManager.runCode(`
import sys, json, tempfile
try:
    from kokoro import KPipeline
    pipe = KPipeline(lang_code='a')
    voice = sys.argv[2] if len(sys.argv) > 2 else 'af_heart'
    generator = pipe(sys.argv[1], voice=voice)
    samples = []
    for gs, ps, audio in generator:
        samples.append(audio)
    import numpy as np
    import soundfile as sf
    combined = np.concatenate(samples)
    tmp = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
    sf.write(tmp.name, combined, 24000)
    print(json.dumps({"audioPath": tmp.name}))
except Exception as e:
    print(json.dumps({"error": str(e)}))
`, [input.text, input.voice ?? 'af_heart']) as any;

      if (result.error) return { success: false, error: result.error };
      return { success: true, data: { audioPath: result.audioPath } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};
