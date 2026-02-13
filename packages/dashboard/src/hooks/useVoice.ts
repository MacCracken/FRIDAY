import { useState, useCallback, useRef, useEffect } from 'react';

const STORAGE_KEY = 'friday-voice-enabled';

interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionErrorEvent {
  error: string;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
  }
}

export interface UseVoiceReturn {
  voiceEnabled: boolean;
  toggleVoice: () => void;
  isListening: boolean;
  startListening: () => void;
  stopListening: () => void;
  speak: (text: string) => void;
  isSpeaking: boolean;
  supported: boolean;
  transcript: string;
  clearTranscript: () => void;
}

function getRecognitionConstructor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

export function useVoice(): UseVoiceReturn {
  const hasSpeechRecognition = typeof window !== 'undefined' && !!getRecognitionConstructor();
  const hasSpeechSynthesis = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const supported = hasSpeechRecognition || hasSpeechSynthesis;

  const [voiceEnabled, setVoiceEnabled] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [transcript, setTranscript] = useState('');

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const shouldRestartRef = useRef(false);

  // Persist voiceEnabled
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(voiceEnabled));
    } catch {
      // ignore
    }
  }, [voiceEnabled]);

  const startListening = useCallback(() => {
    if (!hasSpeechRecognition) return;

    const SpeechRec = getRecognitionConstructor();
    if (!SpeechRec) return;

    // Stop existing instance
    if (recognitionRef.current) {
      shouldRestartRef.current = false;
      recognitionRef.current.abort();
    }

    const recognition = new SpeechRec();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let finalTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript;
        }
      }
      if (finalTranscript) {
        setTranscript(finalTranscript);
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error !== 'aborted' && event.error !== 'no-speech') {
        console.warn('Speech recognition error:', event.error);
      }
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
      // Auto-restart if voice is still enabled
      if (shouldRestartRef.current) {
        setTimeout(() => {
          if (shouldRestartRef.current) {
            startListening();
          }
        }, 300);
      }
    };

    recognitionRef.current = recognition;
    shouldRestartRef.current = true;

    try {
      recognition.start();
      setIsListening(true);
    } catch {
      setIsListening(false);
    }
  }, [hasSpeechRecognition]);

  const stopListening = useCallback(() => {
    shouldRestartRef.current = false;
    if (recognitionRef.current) {
      recognitionRef.current.abort();
      recognitionRef.current = null;
    }
    setIsListening(false);
  }, []);

  const toggleVoice = useCallback(() => {
    setVoiceEnabled((prev) => {
      const next = !prev;
      if (next && hasSpeechRecognition) {
        // Will start listening on next render via effect
      } else {
        // Stop everything
        shouldRestartRef.current = false;
        if (recognitionRef.current) {
          recognitionRef.current.abort();
          recognitionRef.current = null;
        }
        setIsListening(false);
        if (hasSpeechSynthesis) {
          window.speechSynthesis.cancel();
          setIsSpeaking(false);
        }
      }
      return next;
    });
  }, [hasSpeechRecognition, hasSpeechSynthesis]);

  // Start/stop listening when voiceEnabled changes
  useEffect(() => {
    if (voiceEnabled && hasSpeechRecognition) {
      startListening();
    } else {
      stopListening();
    }
    return () => {
      shouldRestartRef.current = false;
    };
  }, [voiceEnabled, hasSpeechRecognition, startListening, stopListening]);

  const speak = useCallback((text: string) => {
    if (!hasSpeechSynthesis) return;

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    window.speechSynthesis.speak(utterance);
  }, [hasSpeechSynthesis]);

  const clearTranscript = useCallback(() => {
    setTranscript('');
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      shouldRestartRef.current = false;
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
      if (hasSpeechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, [hasSpeechSynthesis]);

  return {
    voiceEnabled,
    toggleVoice,
    isListening,
    startListening,
    stopListening,
    speak,
    isSpeaking,
    supported,
    transcript,
    clearTranscript,
  };
}
