import { Mic, MicOff, Volume2 } from 'lucide-react';

interface VoiceToggleProps {
  voiceEnabled: boolean;
  isListening: boolean;
  isSpeaking: boolean;
  supported: boolean;
  onToggle: () => void;
}

export function VoiceToggle({
  voiceEnabled,
  isListening,
  isSpeaking,
  supported,
  onToggle,
}: VoiceToggleProps) {
  if (!supported) {
    return (
      <button
        disabled
        className="btn-ghost p-2 rounded-md opacity-40 cursor-not-allowed"
        title="Voice not supported in this browser"
        aria-label="Voice not supported"
      >
        <MicOff className="w-4 h-4" />
      </button>
    );
  }

  if (isSpeaking) {
    return (
      <button
        onClick={onToggle}
        className="btn-ghost p-2 rounded-md text-primary"
        title="Speaking... Click to disable voice"
        aria-label="Voice active, speaking"
      >
        <Volume2 className="w-4 h-4 animate-pulse" />
      </button>
    );
  }

  if (isListening) {
    return (
      <button
        onClick={onToggle}
        className="btn-ghost p-2 rounded-md relative text-primary"
        title="Listening... Click to disable voice"
        aria-label="Voice active, listening"
      >
        <Mic className="w-4 h-4" />
        <span className="absolute inset-0 rounded-md border-2 border-primary animate-ping opacity-30" />
      </button>
    );
  }

  return (
    <button
      onClick={onToggle}
      className={`btn-ghost p-2 rounded-md ${voiceEnabled ? 'text-primary' : 'text-muted-foreground'}`}
      title={voiceEnabled ? 'Disable voice' : 'Enable voice'}
      aria-label={voiceEnabled ? 'Disable voice input' : 'Enable voice input'}
    >
      <Mic className="w-4 h-4" />
    </button>
  );
}
