/**
 * MultimodalManager — Core orchestrator for multimodal I/O capabilities.
 *
 * Provides vision analysis (via AIClient), speech-to-text, text-to-speech,
 * and image generation (via direct OpenAI API calls).
 */

import type {
  MultimodalConfig,
  VisionRequest,
  VisionResult,
  STTRequest,
  STTResult,
  TTSRequest,
  TTSResult,
  ImageGenRequest,
  ImageGenResult,
  HapticRequest,
  HapticResult,
  AIRequest,
  AIResponse,
} from '@secureyeoman/shared';
import type { MultimodalStorage } from './storage.js';
import type { VoiceProfileStore } from './voice/voice-profile-store.js';
import type { VoicePromptCache } from './voice/voice-cache.js';
import type { SecureLogger } from '../logging/logger.js';
import type { HookPoint, HookContext, HookResult } from '../extensions/types.js';
import { transcribeViaAWSTranscribe } from './stt/transcribe.js';
import { transcribeFasterWhisper, isFasterWhisperAvailable } from './stt/faster-whisper.js';
import { synthesizeViaPolly } from './tts/polly.js';
import { synthesizeOrpheus, isOrpheusAvailable } from './tts/orpheus.js';
import { synthesizePiper, isPiperAvailable } from './tts/piper.js';
import { errorToString } from '../utils/errors.js';
import { nativeAvailable } from '../native/index.js';
import * as dhvaniNative from '../native/dhvani.js';
import type { VoiceProfileConfig } from '../native/dhvani.js';

const MAX_BASE64_LENGTH = 20_971_520; // ~20MB encoded
const FETCH_TIMEOUT_MS = 30_000;
const ALLOWED_DALLE_HOSTS = ['oaidalleapiprodscus.blob.core.windows.net'];

// Provider metadata: label + category for UI display
export interface ProviderMeta {
  label: string;
  category: 'local' | 'cloud';
}

export const PROVIDER_META: Record<string, ProviderMeta> = {
  // Vision
  claude: { label: 'Claude (Anthropic)', category: 'cloud' },
  openai: { label: 'OpenAI', category: 'cloud' },
  gemini: { label: 'Gemini (Google)', category: 'cloud' },
  // TTS + STT shared
  voicebox: { label: 'Voicebox (local)', category: 'local' },
  elevenlabs: { label: 'ElevenLabs', category: 'cloud' },
  deepgram: { label: 'Deepgram', category: 'cloud' },
  google: { label: 'Google Cloud', category: 'cloud' },
  azure: { label: 'Azure AI Speech', category: 'cloud' },
  // TTS-only
  cartesia: { label: 'Cartesia', category: 'cloud' },
  playht: { label: 'Play.ht', category: 'cloud' },
  openedai: { label: 'OpenedAI Speech (local)', category: 'local' },
  kokoro: { label: 'Kokoro (local)', category: 'local' },
  orpheus: { label: 'Orpheus (local)', category: 'local' },
  piper: { label: 'Piper (local)', category: 'local' },
  // STT-only
  assemblyai: { label: 'AssemblyAI', category: 'cloud' },
  'faster-whisper': { label: 'faster-whisper (local)', category: 'local' },
  // AWS
  polly: { label: 'AWS Polly', category: 'cloud' },
  transcribe: { label: 'AWS Transcribe', category: 'cloud' },
  // Dhvani (native Rust audio engine via svara/shabda)
  dhvani: { label: 'Dhvani Voice (local)', category: 'local' },
  'dhvani-g2p': { label: 'Dhvani G2P (local, edge)', category: 'local' },
  'dhvani-stt': { label: 'Dhvani + Whisper (local)', category: 'local' },
};

function sanitizeErrorMessage(msg: string): string {
  return msg
    .replace(/sk-[a-zA-Z0-9]{20,}/g, '[REDACTED]')
    .replace(/sk_[a-zA-Z0-9]{20,}/g, '[REDACTED]')
    .replace(/Bearer [a-zA-Z0-9._-]+/g, 'Bearer [REDACTED]')
    .replace(/Token [a-zA-Z0-9._-]{20,}/g, 'Token [REDACTED]');
}

function isAllowedDalleUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return hostname.endsWith('.openai.com') || ALLOWED_DALLE_HOSTS.includes(hostname);
  } catch {
    return false;
  }
}

const FETCH_VOICEBOX_HEALTH_TIMEOUT_MS = 3_000;

export interface SystemPreferencesStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export interface MultimodalManagerDeps {
  logger: SecureLogger;
  aiClient: {
    chat: (request: AIRequest) => Promise<AIResponse>;
  };
  extensionManager?: {
    emit: (hookPoint: HookPoint, context: HookContext) => Promise<HookResult>;
  } | null;
  prefsStorage?: SystemPreferencesStorage | null;
  voiceProfileStore?: VoiceProfileStore | null;
  voiceCache?: VoicePromptCache | null;
}

export class MultimodalManager {
  private readonly storage: MultimodalStorage;
  private readonly deps: MultimodalManagerDeps;
  private readonly config: MultimodalConfig;
  private initialized = false;

  constructor(storage: MultimodalStorage, deps: MultimodalManagerDeps, config: MultimodalConfig) {
    this.storage = storage;
    this.deps = deps;
    this.config = config;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.storage.ensureTables();
    this.initialized = true;
    this.deps.logger.info('MultimodalManager initialized');
  }

  /** Get the base URL for the Voicebox local server (trailing slash stripped). */
  private getVoiceboxUrl(): string {
    return (process.env.VOICEBOX_URL ?? 'http://localhost:17493').replace(/\/$/, '');
  }

  /** Resolve the active vision provider: env var > DB pref > config default. */
  private async resolveVisionProvider(): Promise<string> {
    if (process.env.VISION_PROVIDER) return process.env.VISION_PROVIDER.toLowerCase();
    const pref = await this.deps.prefsStorage?.get('multimodal.vision.provider');
    if (pref) return pref.toLowerCase();
    return (this.config.vision.provider ?? 'claude').toLowerCase();
  }

  /** Resolve the active TTS provider: env var > DB pref > auto-select (Polly if POLLY_REGION) > config default. */
  private async resolveTTSProvider(): Promise<string> {
    if (process.env.TTS_PROVIDER) return process.env.TTS_PROVIDER.toLowerCase();
    const pref = await this.deps.prefsStorage?.get('multimodal.tts.provider');
    if (pref) return pref.toLowerCase();
    // Auto-select Polly when POLLY_REGION is configured
    if (process.env.POLLY_REGION && process.env.AWS_ACCESS_KEY_ID) return 'polly';
    // Auto-select Orpheus when its URL is explicitly configured
    if (process.env.ORPHEUS_URL) return 'orpheus';
    // Auto-select Piper when its URL is explicitly configured
    if (process.env.PIPER_URL) return 'piper';
    // Auto-select dhvani when native module is available and no cloud provider configured
    if (nativeAvailable) return 'dhvani';
    return (this.config.tts.provider ?? 'openai').toLowerCase();
  }

  /** Resolve the active STT provider: env var > DB pref > auto-select (Transcribe if TRANSCRIBE_REGION) > config default. */
  private async resolveSTTProvider(): Promise<string> {
    if (process.env.STT_PROVIDER) return process.env.STT_PROVIDER.toLowerCase();
    const pref = await this.deps.prefsStorage?.get('multimodal.stt.provider');
    if (pref) return pref.toLowerCase();
    // Auto-select Transcribe when TRANSCRIBE_REGION is configured
    if (process.env.TRANSCRIBE_REGION && process.env.AWS_ACCESS_KEY_ID) return 'transcribe';
    // Auto-select faster-whisper when its URL is explicitly configured
    if (process.env.FASTER_WHISPER_URL) return 'faster-whisper';
    // Auto-select dhvani preprocessing + faster-whisper when native is available
    if (nativeAvailable && process.env.FASTER_WHISPER_URL) return 'dhvani';
    return (this.config.stt.provider ?? 'openai').toLowerCase();
  }

  /** Resolve the active STT model: env var > DB pref > config default. */
  private async resolveSTTModel(): Promise<string> {
    if (process.env.WHISPER_MODEL) return process.env.WHISPER_MODEL;
    const pref = await this.deps.prefsStorage?.get('multimodal.stt.model');
    if (pref) return pref;
    return this.config.stt.model ?? 'whisper-1';
  }

  /** Check whether the Voicebox service is reachable. */
  private async isVoiceboxReachable(): Promise<boolean> {
    try {
      const baseUrl = this.getVoiceboxUrl();
      const res = await fetch(`${baseUrl}/health`, {
        signal: AbortSignal.timeout(FETCH_VOICEBOX_HEALTH_TIMEOUT_MS),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Check whether the Kokoro local TTS package is installed. */
  private async isKokoroAvailable(): Promise<boolean> {
    try {
      // @ts-expect-error — kokoro-js is an optional dependency
      await import('kokoro-js');
      return true;
    } catch {
      return false;
    }
  }

  /** Check whether the OpenedAI Speech local server is reachable. */
  private async isOpenedAIReachable(): Promise<boolean> {
    const url = process.env.OPENEDAI_SPEECH_URL;
    if (!url) return false;
    try {
      const res = await fetch(`${url.replace(/\/$/, '')}/v1/audio/speech`, {
        method: 'HEAD',
        signal: AbortSignal.timeout(FETCH_VOICEBOX_HEALTH_TIMEOUT_MS),
      });
      // Any response (including 405 Method Not Allowed) means server is up
      return res.status < 500;
    } catch {
      return false;
    }
  }

  /** Synthesize speech via dhvani native voice synthesis (svara).
   *  When prosodyConfig is provided (from bhava personality traits), it shapes the voice. */
  private synthesizeViaDhvani(
    request: TTSRequest,
    useG2POnly: boolean,
    prosodyConfig?: VoiceProfileConfig | null
  ): { audioBase64: string; format: string } {
    // Priority: explicit prosody config (from bhava traits) > voice field > default
    const voiceProfile = prosodyConfig
      ? dhvaniNative.voiceProfileFromConfig(prosodyConfig)
      : request.voice && request.voice !== 'alloy'
        ? dhvaniNative.voiceProfileFromConfig({
            base: request.voice as 'male' | 'female' | 'child',
          })
        : null;

    let pcmBuffer: Buffer | null;
    if (useG2POnly) {
      // G2P-only path: text -> phonemes -> synthesis (lightweight, edge-friendly)
      const phonemes = dhvaniNative.g2pConvert(request.text);
      if (!phonemes) throw new Error('dhvani native module unavailable for G2P');
      pcmBuffer = dhvaniNative.synthesizePhonemes(JSON.stringify(phonemes), voiceProfile, 44100);
    } else {
      // Full path: text -> G2P -> phoneme sequence -> voice synthesis
      pcmBuffer = dhvaniNative.synthesizeSpeech(request.text, voiceProfile, 44100);
    }

    if (!pcmBuffer) throw new Error('dhvani native module unavailable');

    // Convert PCM f32 -> WAV for consistent output format
    const wavBuffer = dhvaniNative.pcmToWav(pcmBuffer, 44100);
    if (!wavBuffer) throw new Error('dhvani PCM->WAV conversion failed');

    return { audioBase64: wavBuffer.toString('base64'), format: 'wav' };
  }

  /**
   * Detect which providers are configured/reachable for each modality.
   * Returns configured[], active, metadata (label + category) for each modality.
   */
  async detectAvailableProviders(): Promise<{
    vision: {
      available: string[];
      configured: string[];
      active: string;
      metadata: Record<string, ProviderMeta>;
    };
    tts: {
      available: string[];
      configured: string[];
      active: string;
      voiceboxUrl?: string;
      metadata: Record<string, ProviderMeta>;
    };
    stt: {
      available: string[];
      configured: string[];
      active: string;
      model: string;
      voiceboxUrl?: string;
      metadata: Record<string, ProviderMeta>;
    };
  }> {
    const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
    const hasOpenAI = !!process.env.OPENAI_API_KEY;
    const hasGemini = !!(process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY);
    const hasElevenLabs = !!process.env.ELEVENLABS_API_KEY;
    const hasDeepgram = !!process.env.DEEPGRAM_API_KEY;
    const hasCartesia = !!process.env.CARTESIA_API_KEY;
    // Google REST TTS/STT uses GOOGLE_API_KEY (separate from Gemini vision)
    const hasGoogleSpeech = !!process.env.GOOGLE_API_KEY;
    const hasAzure = !!(process.env.SPEECH_KEY && process.env.SPEECH_REGION);
    const hasPlayHT = !!(process.env.PLAYHT_API_KEY && process.env.PLAYHT_USER_ID);
    const hasAssemblyAI = !!process.env.ASSEMBLYAI_API_KEY;
    const hasPolly = !!(process.env.POLLY_REGION && process.env.AWS_ACCESS_KEY_ID);
    const hasTranscribe = !!(process.env.TRANSCRIBE_REGION && process.env.AWS_ACCESS_KEY_ID);

    const [
      voiceboxReachable,
      openedAIReachable,
      kokoroAvailable,
      orpheusReachable,
      piperReachable,
      fasterWhisperReachable,
    ] = await Promise.all([
      this.isVoiceboxReachable(),
      this.isOpenedAIReachable(),
      this.isKokoroAvailable(),
      isOrpheusAvailable(),
      isPiperAvailable(),
      isFasterWhisperAvailable(),
    ]);
    const voiceboxUrl = this.getVoiceboxUrl();

    const visionConfigured: string[] = [];
    if (hasAnthropic) visionConfigured.push('claude');
    if (hasOpenAI) visionConfigured.push('openai');
    if (hasGemini) visionConfigured.push('gemini');

    const ttsConfigured: string[] = [];
    if (hasOpenAI) ttsConfigured.push('openai');
    if (voiceboxReachable) ttsConfigured.push('voicebox');
    if (hasElevenLabs) ttsConfigured.push('elevenlabs');
    if (hasDeepgram) ttsConfigured.push('deepgram');
    if (hasCartesia) ttsConfigured.push('cartesia');
    if (hasGoogleSpeech) ttsConfigured.push('google');
    if (hasAzure) ttsConfigured.push('azure');
    if (hasPlayHT) ttsConfigured.push('playht');
    if (openedAIReachable) ttsConfigured.push('openedai');
    if (kokoroAvailable) ttsConfigured.push('kokoro');
    if (hasPolly) ttsConfigured.push('polly');
    if (orpheusReachable) ttsConfigured.push('orpheus');
    if (piperReachable) ttsConfigured.push('piper');
    if (nativeAvailable) {
      ttsConfigured.push('dhvani');
      ttsConfigured.push('dhvani-g2p');
    }

    const sttConfigured: string[] = [];
    if (hasOpenAI) sttConfigured.push('openai');
    if (voiceboxReachable) sttConfigured.push('voicebox');
    if (hasDeepgram) sttConfigured.push('deepgram');
    if (hasElevenLabs) sttConfigured.push('elevenlabs');
    if (hasAssemblyAI) sttConfigured.push('assemblyai');
    if (hasGoogleSpeech) sttConfigured.push('google');
    if (hasAzure) sttConfigured.push('azure');
    if (hasTranscribe) sttConfigured.push('transcribe');
    if (fasterWhisperReachable) sttConfigured.push('faster-whisper');
    if (nativeAvailable) sttConfigured.push('dhvani');

    const [activeVision, activeTTS, activeSTT, activeSTTModel] = await Promise.all([
      this.resolveVisionProvider(),
      this.resolveTTSProvider(),
      this.resolveSTTProvider(),
      this.resolveSTTModel(),
    ]);

    // Build metadata subset for only the configured providers in each category
    const metaFor = (ids: string[]): Record<string, ProviderMeta> =>
      Object.fromEntries(
        ids.map((id) => [id, PROVIDER_META[id] ?? { label: id, category: 'cloud' as const }])
      );

    return {
      vision: {
        available: ['claude', 'openai', 'gemini'],
        configured: visionConfigured,
        active: activeVision,
        metadata: metaFor(visionConfigured),
      },
      tts: {
        available: [
          'openai',
          'voicebox',
          'elevenlabs',
          'deepgram',
          'cartesia',
          'google',
          'azure',
          'playht',
          'openedai',
          'kokoro',
          'polly',
          'orpheus',
          'piper',
          'dhvani',
          'dhvani-g2p',
        ],
        configured: ttsConfigured,
        active: activeTTS,
        voiceboxUrl,
        metadata: metaFor(ttsConfigured),
      },
      stt: {
        available: [
          'openai',
          'voicebox',
          'deepgram',
          'elevenlabs',
          'assemblyai',
          'google',
          'azure',
          'transcribe',
          'faster-whisper',
          'dhvani',
        ],
        configured: sttConfigured,
        active: activeSTT,
        model: activeSTTModel,
        voiceboxUrl,
        metadata: metaFor(sttConfigured),
      },
    };
  }

  /** Update the active provider preference in storage. */
  async setProvider(type: 'vision' | 'tts' | 'stt', provider: string): Promise<void> {
    await this.deps.prefsStorage?.set(`multimodal.${type}.provider`, provider);
  }

  /** Update the active model preference in storage. */
  async setModel(type: 'stt' | 'tts', model: string): Promise<void> {
    await this.deps.prefsStorage?.set(`multimodal.${type}.model`, model);
  }

  /** Transcribe audio via the Voicebox local Whisper backend. */
  private async transcribeViaVoicebox(
    request: STTRequest
  ): Promise<{ text: string; language?: string }> {
    const baseUrl = this.getVoiceboxUrl();
    const audioBuffer = Buffer.from(request.audioBase64, 'base64');
    const blob = new Blob([audioBuffer], { type: `audio/${request.format ?? 'wav'}` });
    const formData = new FormData();
    formData.append('file', blob, `audio.${request.format ?? 'wav'}`);

    const response = await fetch(`${baseUrl}/transcribe`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Voicebox STT error (${response.status}): ${errBody}`);
    }

    return (await response.json()) as { text: string; language?: string };
  }

  /** Synthesize speech via the Voicebox local Qwen3-TTS backend. */
  private async synthesizeViaVoicebox(
    request: TTSRequest
  ): Promise<{ audioBase64: string; format: string }> {
    const baseUrl = this.getVoiceboxUrl();
    const profileId = process.env.VOICEBOX_PROFILE_ID;
    if (!profileId) {
      throw new Error(
        'VOICEBOX_PROFILE_ID environment variable is required when TTS_PROVIDER=voicebox'
      );
    }

    const genResponse = await fetch(`${baseUrl}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile_id: profileId, text: request.text }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!genResponse.ok) {
      const errBody = await genResponse.text();
      throw new Error(`Voicebox TTS error (${genResponse.status}): ${errBody}`);
    }

    const genData = (await genResponse.json()) as { id: string };

    const audioResponse = await fetch(`${baseUrl}/audio/${genData.id}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!audioResponse.ok) {
      throw new Error(`Voicebox audio fetch error (${audioResponse.status})`);
    }

    const arrayBuffer = await audioResponse.arrayBuffer();
    return { audioBase64: Buffer.from(arrayBuffer).toString('base64'), format: 'wav' };
  }

  // ── TTS provider implementations ────────────────────────────────────────────

  /** ElevenLabs TTS — POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id} */
  private async synthesizeViaElevenLabs(
    request: TTSRequest
  ): Promise<{ audioBase64: string; format: string }> {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) throw new Error('ELEVENLABS_API_KEY is not set');

    // Voice: request.voice if not the openai default, else ELEVENLABS_VOICE_ID env, else Rachel
    const voiceId =
      request.voice !== 'alloy'
        ? request.voice
        : (process.env.ELEVENLABS_VOICE_ID ?? '21m00Tcm4TlvDq8ikWAM');

    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: request.text,
        model_id: process.env.ELEVENLABS_MODEL ?? 'eleven_multilingual_v2',
        voice_settings: { stability: 0.5, similarity_boost: 0.8 },
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`ElevenLabs TTS error (${res.status}): ${err}`);
    }
    const buf = await res.arrayBuffer();
    return { audioBase64: Buffer.from(buf).toString('base64'), format: 'mp3' };
  }

  /** Deepgram TTS — POST https://api.deepgram.com/v1/speak */
  private async synthesizeViaDeepgram(
    request: TTSRequest
  ): Promise<{ audioBase64: string; format: string }> {
    const apiKey = process.env.DEEPGRAM_API_KEY;
    if (!apiKey) throw new Error('DEEPGRAM_API_KEY is not set');

    const model =
      request.voice !== 'alloy'
        ? request.voice
        : (process.env.DEEPGRAM_TTS_MODEL ?? 'aura-2-thalia-en');

    const res = await fetch(
      `https://api.deepgram.com/v1/speak?model=${encodeURIComponent(model)}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Token ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: request.text }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      }
    );
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Deepgram TTS error (${res.status}): ${err}`);
    }
    const buf = await res.arrayBuffer();
    return { audioBase64: Buffer.from(buf).toString('base64'), format: 'mp3' };
  }

  /** Cartesia TTS — POST https://api.cartesia.ai/tts/bytes */
  private async synthesizeViaCartesia(
    request: TTSRequest
  ): Promise<{ audioBase64: string; format: string }> {
    const apiKey = process.env.CARTESIA_API_KEY;
    if (!apiKey) throw new Error('CARTESIA_API_KEY is not set');

    const voiceId =
      request.voice !== 'alloy'
        ? request.voice
        : (process.env.CARTESIA_VOICE_ID ?? '694f9389-aac1-45b6-b726-9d9369183238');

    const res = await fetch('https://api.cartesia.ai/tts/bytes', {
      method: 'POST',
      headers: {
        'X-API-Key': apiKey,
        'Cartesia-Version': '2024-06-10',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model_id: process.env.CARTESIA_MODEL ?? 'sonic-3',
        transcript: request.text,
        voice: { mode: 'id', id: voiceId },
        output_format: { container: 'mp3', encoding: 'mp3', sample_rate: 44100 },
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Cartesia TTS error (${res.status}): ${err}`);
    }
    const buf = await res.arrayBuffer();
    return { audioBase64: Buffer.from(buf).toString('base64'), format: 'mp3' };
  }

  /** Google Cloud TTS — REST API with GOOGLE_API_KEY */
  private async synthesizeViaGoogle(
    request: TTSRequest
  ): Promise<{ audioBase64: string; format: string }> {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) throw new Error('GOOGLE_API_KEY is not set');

    const voiceName =
      request.voice !== 'alloy'
        ? request.voice
        : (process.env.GOOGLE_TTS_VOICE ?? 'en-US-Neural2-C');

    const res = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { text: request.text },
          voice: { languageCode: voiceName.slice(0, 5), name: voiceName },
          audioConfig: { audioEncoding: 'MP3' },
        }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      }
    );
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Google TTS error (${res.status}): ${err}`);
    }
    const data = (await res.json()) as { audioContent: string };
    return { audioBase64: data.audioContent, format: 'mp3' };
  }

  /** Azure AI Speech TTS — REST API with SPEECH_KEY + SPEECH_REGION */
  private async synthesizeViaAzure(
    request: TTSRequest
  ): Promise<{ audioBase64: string; format: string }> {
    const speechKey = process.env.SPEECH_KEY;
    const region = process.env.SPEECH_REGION;
    if (!speechKey || !region)
      throw new Error('SPEECH_KEY and SPEECH_REGION are required for Azure TTS');

    const voiceName =
      request.voice !== 'alloy'
        ? request.voice
        : (process.env.AZURE_TTS_VOICE ?? 'en-US-AvaMultilingualNeural');

    const ssml = `<speak version='1.0' xml:lang='en-US'><voice name='${voiceName}'>${request.text.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c] ?? c)}</voice></speak>`;

    const res = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': speechKey,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-16khz-32kbitrate-mono-mp3',
      },
      body: ssml,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Azure TTS error (${res.status}): ${err}`);
    }
    const buf = await res.arrayBuffer();
    return { audioBase64: Buffer.from(buf).toString('base64'), format: 'mp3' };
  }

  /** Play.ht TTS — streaming endpoint */
  private async synthesizeViaPlayHT(
    request: TTSRequest
  ): Promise<{ audioBase64: string; format: string }> {
    const apiKey = process.env.PLAYHT_API_KEY;
    const userId = process.env.PLAYHT_USER_ID;
    if (!apiKey || !userId) throw new Error('PLAYHT_API_KEY and PLAYHT_USER_ID are required');

    const voice =
      request.voice !== 'alloy'
        ? request.voice
        : (process.env.PLAYHT_VOICE ??
          's3://peregrine-voices/oliver_narrative2_parrot_saad/manifest.json');

    const res = await fetch('https://api.play.ht/api/v2/tts/stream', {
      method: 'POST',
      headers: {
        AUTHORIZATION: apiKey,
        'X-USER-ID': userId,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: request.text,
        voice,
        output_format: 'mp3',
        voice_engine: 'Play3.0-mini',
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Play.ht TTS error (${res.status}): ${err}`);
    }
    const buf = await res.arrayBuffer();
    return { audioBase64: Buffer.from(buf).toString('base64'), format: 'mp3' };
  }

  /** OpenedAI Speech — local OpenAI-compatible TTS server (OPENEDAI_SPEECH_URL) */
  private async synthesizeViaOpenedAI(
    request: TTSRequest
  ): Promise<{ audioBase64: string; format: string }> {
    const baseUrl = (process.env.OPENEDAI_SPEECH_URL ?? '').replace(/\/$/, '');
    if (!baseUrl) throw new Error('OPENEDAI_SPEECH_URL is not set');

    const res = await fetch(`${baseUrl}/v1/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: request.model,
        input: request.text,
        voice: request.voice,
        response_format: request.responseFormat,
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenedAI Speech error (${res.status}): ${err}`);
    }
    const buf = await res.arrayBuffer();
    return { audioBase64: Buffer.from(buf).toString('base64'), format: request.responseFormat };
  }

  /** Kokoro local TTS — ONNX-based, requires kokoro-js package */
  private async synthesizeViaKokoro(
    request: TTSRequest
  ): Promise<{ audioBase64: string; format: string }> {
    let KokoroTTS: {
      from_pretrained: (
        model: string,
        opts: { dtype: string }
      ) => Promise<{
        generate: (
          text: string,
          opts: { voice: string }
        ) => Promise<{ save: (path: string) => Promise<void> }>;
      }>;
    };
    try {
      // @ts-expect-error — kokoro-js is an optional dependency
      const mod = await import('kokoro-js');
      KokoroTTS = mod.KokoroTTS;
    } catch {
      throw new Error('kokoro-js package is not installed. Run: npm install kokoro-js');
    }

    const voice =
      request.voice !== 'alloy' ? request.voice : (process.env.KOKORO_VOICE ?? 'af_heart');

    // Kokoro generates audio and saves to a temp file; read back as base64
    const os = await import('node:os');
    const path = await import('node:path');
    const fs = await import('node:fs/promises');
    const tmpFile = path.join(os.tmpdir(), `kokoro_${Date.now()}.wav`);

    try {
      const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0', {
        dtype: 'q8',
      });
      const audio = await tts.generate(request.text, { voice });
      await audio.save(tmpFile);
      const buf = await fs.readFile(tmpFile);
      return { audioBase64: buf.toString('base64'), format: 'wav' };
    } finally {
      await fs.unlink(tmpFile).catch(() => undefined);
    }
  }

  // ── STT provider implementations ────────────────────────────────────────────

  /** Deepgram STT — prerecorded transcription */
  private async transcribeViaDeepgram(
    request: STTRequest
  ): Promise<{ text: string; language?: string }> {
    const apiKey = process.env.DEEPGRAM_API_KEY;
    if (!apiKey) throw new Error('DEEPGRAM_API_KEY is not set');

    const model = process.env.DEEPGRAM_STT_MODEL ?? 'nova-3';
    const audioBuffer = Buffer.from(request.audioBase64, 'base64');
    const params = new URLSearchParams({ model, smart_format: 'true' });
    if (request.language) params.set('language', request.language);

    const res = await fetch(`https://api.deepgram.com/v1/listen?${params.toString()}`, {
      method: 'POST',
      headers: {
        Authorization: `Token ${apiKey}`,
        'Content-Type': `audio/${request.format ?? 'wav'}`,
      },
      body: audioBuffer,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Deepgram STT error (${res.status}): ${err}`);
    }
    const data = (await res.json()) as {
      results?: { channels?: { alternatives?: { transcript: string }[] }[] };
      metadata?: { detected_language?: string };
    };
    const text = data.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '';
    return { text, language: data.metadata?.detected_language };
  }

  /** ElevenLabs STT — Scribe v2 */
  private async transcribeViaElevenLabs(
    request: STTRequest
  ): Promise<{ text: string; language?: string }> {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) throw new Error('ELEVENLABS_API_KEY is not set');

    const audioBuffer = Buffer.from(request.audioBase64, 'base64');
    const blob = new Blob([audioBuffer], { type: `audio/${request.format ?? 'wav'}` });
    const formData = new FormData();
    formData.append('file', blob, `audio.${request.format ?? 'wav'}`);
    formData.append('model_id', process.env.ELEVENLABS_STT_MODEL ?? 'scribe_v2');
    if (request.language) formData.append('language_code', request.language);

    const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: { 'xi-api-key': apiKey },
      body: formData,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`ElevenLabs STT error (${res.status}): ${err}`);
    }
    const data = (await res.json()) as { text: string; language_code?: string };
    return { text: data.text, language: data.language_code };
  }

  /** AssemblyAI STT — upload then poll for transcript */
  private async transcribeViaAssemblyAI(
    request: STTRequest
  ): Promise<{ text: string; language?: string }> {
    const apiKey = process.env.ASSEMBLYAI_API_KEY;
    if (!apiKey) throw new Error('ASSEMBLYAI_API_KEY is not set');

    const headers = { Authorization: apiKey, 'Content-Type': 'application/json' };
    const audioBuffer = Buffer.from(request.audioBase64, 'base64');

    // 1. Upload audio
    const uploadRes = await fetch('https://api.assemblyai.com/v2/upload', {
      method: 'POST',
      headers: { Authorization: apiKey, 'Content-Type': 'application/octet-stream' },
      body: audioBuffer,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!uploadRes.ok) {
      const err = await uploadRes.text();
      throw new Error(`AssemblyAI upload error (${uploadRes.status}): ${err}`);
    }
    const { upload_url } = (await uploadRes.json()) as { upload_url: string };

    // 2. Submit transcript job
    const submitRes = await fetch('https://api.assemblyai.com/v2/transcript', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        audio_url: upload_url,
        language_code: request.language ?? 'en',
        language_detection: !request.language,
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!submitRes.ok) {
      const err = await submitRes.text();
      throw new Error(`AssemblyAI submit error (${submitRes.status}): ${err}`);
    }
    const { id } = (await submitRes.json()) as { id: string };

    // 3. Poll until complete (max 60s)
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1000));
      const pollRes = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, {
        headers,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!pollRes.ok) continue;
      const result = (await pollRes.json()) as {
        status: string;
        text?: string;
        language_code?: string;
        error?: string;
      };
      if (result.status === 'completed') {
        return { text: result.text ?? '', language: result.language_code };
      }
      if (result.status === 'error') {
        throw new Error(`AssemblyAI transcription error: ${result.error ?? 'unknown'}`);
      }
    }
    throw new Error('AssemblyAI transcription timed out (60s)');
  }

  /** Google Cloud STT — REST API with GOOGLE_API_KEY (synchronous, max ~1 min audio) */
  private async transcribeViaGoogle(
    request: STTRequest
  ): Promise<{ text: string; language?: string }> {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) throw new Error('GOOGLE_API_KEY is not set');

    // Map format to Google encoding name
    const encodingMap: Record<string, string> = {
      wav: 'LINEAR16',
      flac: 'FLAC',
      mp3: 'MP3',
      ogg: 'OGG_OPUS',
      webm: 'WEBM_OPUS',
    };
    const encoding = encodingMap[request.format ?? 'wav'] ?? 'LINEAR16';

    const res = await fetch(`https://speech.googleapis.com/v1/speech:recognize?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        config: {
          encoding,
          languageCode: request.language ?? 'en-US',
          model: process.env.GOOGLE_STT_MODEL ?? 'latest_long',
          enableAutomaticPunctuation: true,
        },
        audio: { content: request.audioBase64 },
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Google STT error (${res.status}): ${err}`);
    }
    const data = (await res.json()) as {
      results?: { alternatives?: { transcript: string }[] }[];
    };
    const text = data.results?.map((r) => r.alternatives?.[0]?.transcript ?? '').join(' ') ?? '';
    return { text, language: request.language };
  }

  /** Azure AI Speech STT — REST API with SPEECH_KEY + SPEECH_REGION */
  private async transcribeViaAzure(
    request: STTRequest
  ): Promise<{ text: string; language?: string }> {
    const speechKey = process.env.SPEECH_KEY;
    const region = process.env.SPEECH_REGION;
    if (!speechKey || !region)
      throw new Error('SPEECH_KEY and SPEECH_REGION are required for Azure STT');

    const language = request.language ?? 'en-US';
    const audioBuffer = Buffer.from(request.audioBase64, 'base64');

    const formatMap: Record<string, string> = {
      wav: 'audio/wav; codec=audio/pcm; samplerate=16000',
      ogg: 'audio/ogg; codec=opus',
      webm: 'audio/webm; codec=opus',
    };
    const contentType =
      formatMap[request.format ?? 'wav'] ?? 'audio/wav; codec=audio/pcm; samplerate=16000';

    const res = await fetch(
      `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${language}`,
      {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': speechKey,
          'Content-Type': contentType,
        },
        body: audioBuffer,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      }
    );
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Azure STT error (${res.status}): ${err}`);
    }
    const data = (await res.json()) as {
      RecognitionStatus: string;
      DisplayText?: string;
    };
    if (data.RecognitionStatus !== 'Success') {
      throw new Error(`Azure STT recognition failed: ${data.RecognitionStatus}`);
    }
    return { text: data.DisplayText ?? '', language };
  }

  /**
   * Analyze an image using the AI client's vision capability.
   */
  async analyzeImage(request: VisionRequest): Promise<VisionResult> {
    if (!this.config.vision.enabled) {
      throw new Error('Vision capability is disabled');
    }

    if (request.imageBase64.length > MAX_BASE64_LENGTH) {
      throw new Error('Image data exceeds maximum allowed size');
    }

    const jobId = await this.storage.createJob('vision', {
      mimeType: request.mimeType,
      prompt: request.prompt,
      imageSizeBytes: request.imageBase64.length,
    });

    const start = Date.now();
    try {
      const prompt = request.prompt ?? 'Describe this image in detail.';
      const provider = await this.resolveVisionProvider();
      let description: string;

      if (provider === 'openai') {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) throw new Error('OPENAI_API_KEY environment variable is not set');
        const body = {
          model: 'gpt-4o',
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image_url',
                  image_url: { url: `data:${request.mimeType};base64,${request.imageBase64}` },
                },
                { type: 'text', text: prompt },
              ],
            },
          ],
          max_tokens: 1024,
        };
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!res.ok) {
          const errBody = await res.text();
          throw new Error(`OpenAI vision error (${res.status}): ${errBody}`);
        }
        const data = (await res.json()) as {
          choices: { message: { content: string } }[];
        };
        description = data.choices[0]?.message?.content ?? '';
      } else if (provider === 'gemini') {
        const apiKey = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
        if (!apiKey)
          throw new Error('GOOGLE_API_KEY or GEMINI_API_KEY environment variable is not set');
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${apiKey}`;
        const body = {
          contents: [
            {
              parts: [
                { inline_data: { mime_type: request.mimeType, data: request.imageBase64 } },
                { text: prompt },
              ],
            },
          ],
        };
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!res.ok) {
          const errBody = await res.text();
          throw new Error(`Gemini vision error (${res.status}): ${errBody}`);
        }
        const data = (await res.json()) as {
          candidates: { content: { parts: { text: string }[] } }[];
        };
        description = data.candidates[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
      } else {
        // claude (default) — use AIClient
        const response = await this.deps.aiClient.chat({
          messages: [
            {
              role: 'user' as const,
              content: `[image:${request.mimeType};base64,${request.imageBase64}]\n${prompt}`,
            },
          ],
          maxTokens: 1024,
          stream: false,
        });
        description = response.content;
      }

      const durationMs = Date.now() - start;
      const result: VisionResult = {
        description,
        labels: [],
        durationMs,
      };

      await this.storage.completeJob(jobId, result, durationMs);
      void this.deps.extensionManager
        ?.emit('multimodal:image-analyzed', {
          event: 'multimodal:image-analyzed',
          data: { jobId, result },
          timestamp: Date.now(),
        })
        .catch((err: unknown) => {
          this.deps.logger.warn({ err }, 'Failed to emit multimodal:image-analyzed event');
        });
      return result;
    } catch (error) {
      const msg = sanitizeErrorMessage(errorToString(error));
      await this.storage.failJob(jobId, msg);
      this.deps.logger.error({ error: msg }, 'Vision analysis failed');
      throw new Error(msg, { cause: error });
    }
  }

  /**
   * Transcribe audio — routes to OpenAI Whisper or Voicebox local Whisper based on
   * STT_PROVIDER env var (or config.stt.provider). Defaults to 'openai'.
   */
  async transcribeAudio(request: STTRequest): Promise<STTResult> {
    if (!this.config.stt.enabled) {
      throw new Error('Speech-to-text capability is disabled');
    }

    if (request.audioBase64.length > MAX_BASE64_LENGTH) {
      throw new Error('Audio data exceeds maximum allowed size');
    }

    const jobId = await this.storage.createJob('stt', {
      format: request.format,
      language: request.language,
      audioSizeBytes: request.audioBase64.length,
    });

    const start = Date.now();
    try {
      const provider = await this.resolveSTTProvider();

      let data: { text: string; language?: string };

      switch (provider) {
        case 'voicebox':
          data = await this.transcribeViaVoicebox(request);
          break;
        case 'deepgram':
          data = await this.transcribeViaDeepgram(request);
          break;
        case 'elevenlabs':
          data = await this.transcribeViaElevenLabs(request);
          break;
        case 'assemblyai':
          data = await this.transcribeViaAssemblyAI(request);
          break;
        case 'google':
          data = await this.transcribeViaGoogle(request);
          break;
        case 'azure':
          data = await this.transcribeViaAzure(request);
          break;
        case 'transcribe':
          data = await transcribeViaAWSTranscribe(request);
          break;
        case 'faster-whisper': {
          const audioBuffer = Buffer.from(request.audioBase64, 'base64');
          data = await transcribeFasterWhisper(audioBuffer, request.format, request.language);
          break;
        }
        case 'dhvani': {
          // Dhvani preprocessing: noise reduce + resample to 16kHz, then -> faster-whisper
          let processedAudio = Buffer.from(request.audioBase64, 'base64');
          const denoised = dhvaniNative.noiseReduce(processedAudio, 44100, 0.5);
          if (denoised) {
            const resampled = dhvaniNative.resample(denoised, 44100, 16000);
            if (resampled) {
              const wav = dhvaniNative.pcmToWav(resampled, 16000);
              if (wav) processedAudio = Buffer.from(wav);
            }
          }
          data = await transcribeFasterWhisper(processedAudio, 'wav', request.language);
          break;
        }
        default: {
          // openai (default)
          const apiKey = process.env.OPENAI_API_KEY;
          if (!apiKey) throw new Error('OPENAI_API_KEY environment variable is not set');

          const audioBuffer = Buffer.from(request.audioBase64, 'base64');
          const blob = new Blob([audioBuffer], { type: `audio/${request.format}` });

          const formData = new FormData();
          formData.append('file', blob, `audio.${request.format}`);
          formData.append('model', await this.resolveSTTModel());
          if (request.language) formData.append('language', request.language);

          const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}` },
            body: formData,
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          });

          if (!response.ok) {
            const errBody = await response.text();
            throw new Error(`Whisper API error (${response.status}): ${errBody}`);
          }

          data = (await response.json()) as { text: string; language?: string };
        }
      }

      const durationMs = Date.now() - start;
      const result: STTResult = { text: data.text, language: data.language, durationMs };

      await this.storage.completeJob(jobId, result, durationMs);
      void this.deps.extensionManager
        ?.emit('multimodal:audio-transcribed', {
          event: 'multimodal:audio-transcribed',
          data: { jobId, result },
          timestamp: Date.now(),
        })
        .catch((err: unknown) => {
          this.deps.logger.warn({ err }, 'Failed to emit multimodal:audio-transcribed event');
        });
      return result;
    } catch (error) {
      const msg = sanitizeErrorMessage(errorToString(error));
      await this.storage.failJob(jobId, msg);
      this.deps.logger.error({ error: msg }, 'Audio transcription failed');
      throw new Error(msg, { cause: error });
    }
  }

  /**
   * Synthesize speech — routes to OpenAI TTS or Voicebox local Qwen3-TTS based on
   * TTS_PROVIDER env var (or config.tts.provider). Defaults to 'openai'.
   */
  async synthesizeSpeech(request: TTSRequest): Promise<TTSResult> {
    if (!this.config.tts.enabled) {
      throw new Error('Text-to-speech capability is disabled');
    }

    const jobId = await this.storage.createJob('tts', {
      textLength: request.text.length,
      voice: request.voice,
      model: request.model,
    });

    const start = Date.now();
    try {
      const provider = await this.resolveTTSProvider();

      const dispatchTTS = async (): Promise<{ audioBase64: string; format: string }> => {
        switch (provider) {
          case 'voicebox':
            return this.synthesizeViaVoicebox(request);
          case 'elevenlabs':
            return this.synthesizeViaElevenLabs(request);
          case 'deepgram':
            return this.synthesizeViaDeepgram(request);
          case 'cartesia':
            return this.synthesizeViaCartesia(request);
          case 'google':
            return this.synthesizeViaGoogle(request);
          case 'azure':
            return this.synthesizeViaAzure(request);
          case 'playht':
            return this.synthesizeViaPlayHT(request);
          case 'openedai':
            return this.synthesizeViaOpenedAI(request);
          case 'kokoro':
            return this.synthesizeViaKokoro(request);
          case 'polly':
            return synthesizeViaPolly(request);
          case 'orpheus':
            return synthesizeOrpheus(request.text, request.voice, request.model);
          case 'piper':
            return synthesizePiper(request.text, request.voice, request.responseFormat);
          case 'dhvani':
            return this.synthesizeViaDhvani(request, false);
          case 'dhvani-g2p':
            return this.synthesizeViaDhvani(request, true);
          default: {
            // openai (default)
            const apiKey = process.env.OPENAI_API_KEY;
            if (!apiKey) throw new Error('OPENAI_API_KEY environment variable is not set');
            const response = await fetch('https://api.openai.com/v1/audio/speech', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                model: request.model,
                input: request.text,
                voice: request.voice,
                response_format: request.responseFormat,
              }),
              signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            });
            if (!response.ok) {
              const errBody = await response.text();
              throw new Error(`TTS API error (${response.status}): ${errBody}`);
            }
            const arrayBuffer = await response.arrayBuffer();
            return {
              audioBase64: Buffer.from(arrayBuffer).toString('base64'),
              format: request.responseFormat,
            };
          }
        }
      };

      const { audioBase64, format } = await dispatchTTS();

      const durationMs = Date.now() - start;
      const result: TTSResult = { audioBase64, format, durationMs };

      await this.storage.completeJob(
        jobId,
        { format: result.format, durationMs, audioSizeBytes: audioBase64.length },
        durationMs
      );
      void this.deps.extensionManager
        ?.emit('multimodal:speech-generated', {
          event: 'multimodal:speech-generated',
          data: { jobId, format: result.format },
          timestamp: Date.now(),
        })
        .catch((err: unknown) => {
          this.deps.logger.warn({ err }, 'Failed to emit multimodal:speech-generated event');
        });
      return result;
    } catch (error) {
      const msg = sanitizeErrorMessage(errorToString(error));
      await this.storage.failJob(jobId, msg);
      this.deps.logger.error({ error: msg }, 'Speech synthesis failed');
      throw new Error(msg, { cause: error });
    }
  }

  /**
   * Synthesize speech and return raw binary buffer — avoids base64 overhead.
   * For OpenAI, fetches the audio directly; for other providers converts from base64.
   */
  async synthesizeSpeechBinary(
    request: TTSRequest
  ): Promise<{ buffer: Buffer; format: string; durationMs: number }> {
    if (!this.config.tts.enabled) {
      throw new Error('Text-to-speech capability is disabled');
    }

    const jobId = await this.storage.createJob('tts', {
      textLength: request.text.length,
      voice: request.voice,
      model: request.model,
    });

    const start = Date.now();
    try {
      const provider = await this.resolveTTSProvider();

      let buffer: Buffer;
      let format: string;

      const OTHER_PROVIDERS = [
        'voicebox',
        'elevenlabs',
        'deepgram',
        'cartesia',
        'google',
        'azure',
        'playht',
        'openedai',
        'kokoro',
        'polly',
        'orpheus',
        'piper',
      ];

      if (!OTHER_PROVIDERS.includes(provider)) {
        // OpenAI (default): fetch binary directly — no base64 roundtrip
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) throw new Error('OPENAI_API_KEY environment variable is not set');
        const response = await fetch('https://api.openai.com/v1/audio/speech', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: request.model,
            input: request.text,
            voice: request.voice,
            response_format: request.responseFormat,
          }),
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!response.ok) {
          const errBody = await response.text();
          throw new Error(`TTS API error (${response.status}): ${errBody}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        buffer = Buffer.from(arrayBuffer);
        format = request.responseFormat ?? 'mp3';
      } else {
        // All other providers: use their existing base64-returning methods
        let b64result: { audioBase64: string; format: string };
        switch (provider) {
          case 'voicebox':
            b64result = await this.synthesizeViaVoicebox(request);
            break;
          case 'elevenlabs':
            b64result = await this.synthesizeViaElevenLabs(request);
            break;
          case 'deepgram':
            b64result = await this.synthesizeViaDeepgram(request);
            break;
          case 'cartesia':
            b64result = await this.synthesizeViaCartesia(request);
            break;
          case 'google':
            b64result = await this.synthesizeViaGoogle(request);
            break;
          case 'azure':
            b64result = await this.synthesizeViaAzure(request);
            break;
          case 'playht':
            b64result = await this.synthesizeViaPlayHT(request);
            break;
          case 'openedai':
            b64result = await this.synthesizeViaOpenedAI(request);
            break;
          case 'kokoro':
            b64result = await this.synthesizeViaKokoro(request);
            break;
          case 'polly':
            b64result = await synthesizeViaPolly(request);
            break;
          case 'orpheus':
            b64result = await synthesizeOrpheus(request.text, request.voice, request.model);
            break;
          case 'piper':
            b64result = await synthesizePiper(request.text, request.voice, request.responseFormat);
            break;
          case 'dhvani':
            b64result = this.synthesizeViaDhvani(request, false);
            break;
          case 'dhvani-g2p':
            b64result = this.synthesizeViaDhvani(request, true);
            break;
          default:
            throw new Error(`Unknown TTS provider: ${provider}`);
        }
        buffer = Buffer.from(b64result.audioBase64, 'base64');
        format = b64result.format;
      }

      const durationMs = Date.now() - start;
      await this.storage.completeJob(
        jobId,
        { format, durationMs, audioSizeBytes: buffer.length },
        durationMs
      );
      void this.deps.extensionManager
        ?.emit('multimodal:speech-generated', {
          event: 'multimodal:speech-generated',
          data: { jobId, format },
          timestamp: Date.now(),
        })
        .catch((err: unknown) => {
          this.deps.logger.warn({ err }, 'Failed to emit multimodal:speech-generated event');
        });
      return { buffer, format, durationMs };
    } catch (error) {
      const msg = sanitizeErrorMessage(errorToString(error));
      await this.storage.failJob(jobId, msg);
      this.deps.logger.error({ error: msg }, 'Speech synthesis (binary) failed');
      throw new Error(msg, { cause: error });
    }
  }

  /**
   * Generate an image using OpenAI DALL-E API.
   */
  async generateImage(request: ImageGenRequest): Promise<ImageGenResult> {
    if (!this.config.imageGen.enabled) {
      throw new Error('Image generation capability is disabled');
    }

    const jobId = await this.storage.createJob('image_gen', {
      promptLength: request.prompt.length,
      size: request.size,
      quality: request.quality,
    });

    const start = Date.now();
    try {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error('OPENAI_API_KEY environment variable is not set');

      const response = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.config.imageGen.model,
          prompt: request.prompt,
          n: 1,
          size: request.size,
          quality: request.quality,
          style: request.style,
        }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`DALL-E API error (${response.status}): ${errBody}`);
      }

      const data = (await response.json()) as {
        data: { url: string; revised_prompt?: string }[];
      };

      const firstImage = data.data[0];
      if (!firstImage) {
        throw new Error('DALL-E API returned no images');
      }

      if (!isAllowedDalleUrl(firstImage.url)) {
        throw new Error('DALL-E API returned URL from unexpected origin');
      }

      const durationMs = Date.now() - start;
      const result: ImageGenResult = {
        imageUrl: firstImage.url,
        revisedPrompt: firstImage.revised_prompt,
        durationMs,
      };

      await this.storage.completeJob(jobId, result, durationMs);
      void this.deps.extensionManager
        ?.emit('multimodal:image-generated', {
          event: 'multimodal:image-generated',
          data: { jobId, result },
          timestamp: Date.now(),
        })
        .catch((err: unknown) => {
          this.deps.logger.warn({ err }, 'Failed to emit multimodal:image-generated event');
        });
      return result;
    } catch (error) {
      const msg = sanitizeErrorMessage(errorToString(error));
      await this.storage.failJob(jobId, msg);
      this.deps.logger.error({ error: msg }, 'Image generation failed');
      throw new Error(msg, { cause: error });
    }
  }

  /**
   * Trigger haptic feedback — dispatches a pattern via the extension hook system
   * so connected clients (e.g. browser Web Vibration API) can respond.
   */
  async triggerHaptic(request: HapticRequest): Promise<HapticResult> {
    if (!this.config.haptic.enabled) {
      throw new Error('Haptic capability is disabled');
    }

    const pattern = Array.isArray(request.pattern) ? request.pattern : [request.pattern];
    const patternMs = pattern.reduce((sum, n) => sum + n, 0);

    if (patternMs > this.config.haptic.maxPatternDurationMs) {
      throw new Error(
        `Haptic pattern duration ${patternMs}ms exceeds maximum ${this.config.haptic.maxPatternDurationMs}ms`
      );
    }

    const jobId = await this.storage.createJob('haptic', {
      pattern,
      patternMs,
      description: request.description,
    });

    const start = Date.now();
    try {
      const durationMs = Date.now() - start;
      const result: HapticResult = { triggered: true, patternMs, durationMs };

      await this.storage.completeJob(jobId, result, durationMs);
      void this.deps.extensionManager
        ?.emit('multimodal:haptic-triggered', {
          event: 'multimodal:haptic-triggered',
          data: { jobId, pattern, patternMs, description: request.description },
          timestamp: Date.now(),
        })
        .catch((err: unknown) => {
          this.deps.logger.warn({ err }, 'Failed to emit multimodal:haptic-triggered event');
        });
      return result;
    } catch (error) {
      const msg = sanitizeErrorMessage(errorToString(error));
      await this.storage.failJob(jobId, msg);
      this.deps.logger.error({ error: msg }, 'Haptic trigger failed');
      throw new Error(msg, { cause: error });
    }
  }

  /** Get the underlying storage for direct queries. */
  getStorage(): MultimodalStorage {
    return this.storage;
  }

  /** Get current config. */
  getConfig(): MultimodalConfig {
    return this.config;
  }

  /**
   * Synthesize speech using a stored voice profile.
   * Checks the voice cache first, falls back to TTS provider, then caches the result.
   */
  async speakWithProfile(profileId: string, text: string): Promise<TTSResult> {
    const store = this.deps.voiceProfileStore;
    if (!store) {
      throw new Error('Voice profile store is not configured');
    }

    const profile = await store.getById(profileId);
    if (!profile) {
      throw new Error(`Voice profile not found: ${profileId}`);
    }

    // Check cache
    const cache = this.deps.voiceCache;
    if (cache) {
      const cached = cache.get(profile.provider, profile.voiceId, text);
      if (cached) {
        this.deps.logger.info({ profileId, provider: profile.provider }, 'voice cache hit');
        return { audioBase64: cached.toString('base64'), format: 'mp3', durationMs: 0 };
      }
    }

    // Synthesize via the profile's provider and voice settings
    const request: TTSRequest = {
      text,
      voice: profile.voiceId,
      model: (profile.settings.model as string) ?? 'tts-1',
      responseFormat: (profile.settings.responseFormat as 'mp3' | 'opus' | 'aac' | 'flac') ?? 'mp3',
    };

    const result = await this.synthesizeSpeech(request);

    // Store in cache
    if (cache && result.audioBase64) {
      try {
        cache.set(
          profile.provider,
          profile.voiceId,
          text,
          Buffer.from(result.audioBase64, 'base64')
        );
      } catch {
        // cache write failure is non-fatal
      }
    }

    return result;
  }

  close(): void {
    this.storage.close();
    this.initialized = false;
  }
}
