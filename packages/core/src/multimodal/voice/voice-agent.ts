/**
 * VoiceAgentSession — Full-duplex voice conversation pipeline.
 *
 * Pipeline: Audio chunks -> STT streaming -> transcript -> LLM chat -> TTS streaming -> audio chunks
 *
 * Supports barge-in: when the user starts speaking while TTS is playing,
 * the current TTS is aborted and the new transcript is sent to the LLM.
 */

import { EventEmitter } from 'node:events';
import type { MultimodalManager } from '../manager.js';

// ─── Types ──────────────────────────────────────────────────────────

export interface VoiceAgentConfig {
  personalityId: string;
  sttProvider: string;
  ttsProvider: string;
  voiceProfileId?: string;
  /** Bhava personality traits — used to shape dhvani voice prosody. */
  personalityTraits?: Record<string, string>;
  /** Language hint for STT. Default 'en' */
  language?: string;
  /** Silence threshold in ms before flushing STT buffer. Default 1500 */
  silenceThresholdMs?: number;
  /** Max audio buffer size in bytes before forcing flush. Default 512KB */
  maxBufferBytes?: number;
}

export interface VoiceAgentEvents {
  /** Interim STT transcript */
  transcript: (data: { type: 'interim' | 'final'; text: string }) => void;
  /** LLM text response (streamed token-by-token or full) */
  'response-text': (text: string) => void;
  /** TTS audio chunk ready to send to client */
  'response-audio': (chunk: Buffer) => void;
  /** Pipeline finished processing a turn */
  done: () => void;
  /** Error during processing */
  error: (error: Error) => void;
}

type VoiceAgentEvent = keyof VoiceAgentEvents;

/** Frame size for chunking TTS audio over WebSocket */
const CHUNK_SIZE = 4096;

/** Default silence detection threshold */
const DEFAULT_SILENCE_MS = 1500;

/** Default max buffer before forced flush */
const DEFAULT_MAX_BUFFER = 512 * 1024;

// ─── Session ────────────────────────────────────────────────────────

export class VoiceAgentSession {
  private readonly emitter = new EventEmitter();
  private readonly config: Required<
    Pick<VoiceAgentConfig, 'personalityId' | 'sttProvider' | 'ttsProvider' | 'language'>
  > &
    VoiceAgentConfig;

  private multimodalManager: MultimodalManager | null;
  private audioBuffer: Buffer[] = [];
  private audioBufferSize = 0;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private ttsAbortController: AbortController | null = null;
  private closed = false;
  private processing = false;
  private conversationHistory: { role: 'user' | 'assistant'; content: string }[] = [];

  constructor(config: VoiceAgentConfig, multimodalManager: MultimodalManager) {
    this.config = {
      language: 'en',
      silenceThresholdMs: DEFAULT_SILENCE_MS,
      maxBufferBytes: DEFAULT_MAX_BUFFER,
      ...config,
    };
    this.multimodalManager = multimodalManager;
  }

  // ─── Public API ─────────────────────────────────────────────────

  /**
   * Process an incoming audio chunk from the user's microphone.
   * Buffers chunks and flushes to STT on silence detection or buffer limit.
   */
  async processAudioChunk(chunk: Buffer): Promise<void> {
    if (this.closed) return;

    this.audioBuffer.push(chunk);
    this.audioBufferSize += chunk.length;

    // Reset silence timer
    this.resetSilenceTimer();

    // Force flush if buffer is too large
    if (this.audioBufferSize >= (this.config.maxBufferBytes ?? DEFAULT_MAX_BUFFER)) {
      await this.flushAudioBuffer();
    }
  }

  /**
   * Handle barge-in: user starts speaking while TTS is playing.
   * Aborts current TTS output and prepares for new input.
   */
  async interrupt(): Promise<void> {
    if (this.closed) return;

    // Abort any in-flight TTS
    if (this.ttsAbortController) {
      this.ttsAbortController.abort();
      this.ttsAbortController = null;
    }

    this.processing = false;
  }

  /**
   * Register an event listener.
   */
  on<E extends VoiceAgentEvent>(event: E, handler: VoiceAgentEvents[E]): void {
    this.emitter.on(event, handler as (...args: unknown[]) => void);
  }

  /**
   * Clean up resources and close the session.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    if (this.ttsAbortController) {
      this.ttsAbortController.abort();
      this.ttsAbortController = null;
    }

    this.audioBuffer = [];
    this.audioBufferSize = 0;
    this.multimodalManager = null;
    this.emitter.removeAllListeners();
  }

  /** Whether this session has been closed. */
  get isClosed(): boolean {
    return this.closed;
  }

  /** Current conversation history for context. */
  getConversationHistory(): readonly { role: 'user' | 'assistant'; content: string }[] {
    return this.conversationHistory;
  }

  // ─── Internal ───────────────────────────────────────────────────

  private resetSilenceTimer(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
    }
    this.silenceTimer = setTimeout(() => {
      void this.flushAudioBuffer();
    }, this.config.silenceThresholdMs ?? DEFAULT_SILENCE_MS);
  }

  /**
   * Flush the accumulated audio buffer to the STT provider.
   */
  private async flushAudioBuffer(): Promise<void> {
    if (this.audioBuffer.length === 0 || this.closed) return;

    const combined = Buffer.concat(this.audioBuffer);
    this.audioBuffer = [];
    this.audioBufferSize = 0;

    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }

    try {
      // Emit interim result while processing
      this.emitter.emit('transcript', { type: 'interim', text: '...' });

      const text = await this.transcribeBuffer(combined);

      if (text && text.trim().length > 0) {
        this.emitter.emit('transcript', { type: 'final', text });
        await this.onTranscript(text);
      }
    } catch (err) {
      this.emitter.emit('error', err instanceof Error ? err : new Error(String(err)));
    }
  }

  /**
   * Send audio buffer to the STT provider for transcription.
   */
  private async transcribeBuffer(audio: Buffer): Promise<string> {
    if (!this.multimodalManager) {
      throw new Error('Session is closed');
    }

    const result = await this.multimodalManager.transcribeAudio({
      audioBase64: audio.toString('base64'),
      format: 'webm',
      language: this.config.language,
    });

    return result.text;
  }

  /**
   * Called when STT produces a final transcript.
   * Sends to personality LLM and streams TTS response back.
   */
  private async onTranscript(text: string): Promise<void> {
    if (this.closed || !this.multimodalManager) return;

    this.processing = true;

    // Add user message to conversation history
    this.conversationHistory.push({ role: 'user', content: text });

    try {
      // Get LLM response via the AI client
      const llmResponse = await this.getLLMResponse(text);

      if (this.closed || !this.processing) return; // interrupted

      // Add assistant response to history
      this.conversationHistory.push({ role: 'assistant', content: llmResponse });

      // Emit the text response
      this.emitter.emit('response-text', llmResponse);

      // Synthesize TTS and stream audio chunks
      await this.streamTTSResponse(llmResponse);

      if (!this.closed) {
        this.emitter.emit('done');
      }
    } catch (err) {
      if (!this.closed) {
        this.emitter.emit('error', err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      this.processing = false;
    }
  }

  /**
   * Get a response from the LLM using the multimodal manager's AI client.
   */
  private async getLLMResponse(_userText: string): Promise<string> {
    if (!this.multimodalManager) {
      throw new Error('Session is closed');
    }

    // Build messages from conversation history
    const systemPrompt = `You are a voice assistant for personality ${this.config.personalityId}. Keep responses concise and conversational since they will be spoken aloud.`;

    const messages = this.conversationHistory.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    // Use the multimodal manager's AI client to generate a response
    const aiClient = (this.multimodalManager as any).deps?.aiClient;
    if (!aiClient) {
      throw new Error('AI client not available');
    }

    const response = await aiClient.chat({
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      model: undefined, // use default
    });

    return typeof response.content === 'string'
      ? response.content
      : (response.message ?? 'I could not generate a response.');
  }

  /**
   * Synthesize speech from text and stream audio chunks via events.
   */
  private async streamTTSResponse(text: string): Promise<void> {
    if (!this.multimodalManager || this.closed) return;

    this.ttsAbortController = new AbortController();

    try {
      const { buffer } = await this.multimodalManager.synthesizeSpeechBinary({
        text,
        voice: this.config.voiceProfileId ?? 'alloy',
        model: 'tts-1',
        responseFormat: 'mp3',
      });

      // Check if we were interrupted during TTS generation
      if (this.ttsAbortController.signal.aborted || this.closed) return;

      // Chunk the audio buffer and emit
      for (let offset = 0; offset < buffer.length; offset += CHUNK_SIZE) {
        if (this.ttsAbortController.signal.aborted || this.closed) return;
        const chunk = buffer.subarray(offset, Math.min(offset + CHUNK_SIZE, buffer.length));
        this.emitter.emit('response-audio', chunk);
      }
    } finally {
      this.ttsAbortController = null;
    }
  }
}
