import { useRef, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Send, Loader2, Bot, User } from 'lucide-react';
import { fetchActivePersonality } from '../api/client';
import { ModelWidget } from './ModelWidget';
import { VoiceToggle } from './VoiceToggle';
import { useChat } from '../hooks/useChat';
import { useVoice } from '../hooks/useVoice';
import { useState } from 'react';

export function ChatPage() {
  const [showModelWidget, setShowModelWidget] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { data: personalityData } = useQuery({
    queryKey: ['active-personality'],
    queryFn: fetchActivePersonality,
  });

  const personality = personalityData?.personality;

  const { messages, input, setInput, handleSend, isPending } = useChat();
  const voice = useVoice();

  // Feed voice transcript into input
  useEffect(() => {
    if (voice.transcript) {
      setInput((prev: string) => prev + voice.transcript);
      voice.clearTranscript();
    }
  }, [voice.transcript, setInput, voice.clearTranscript]);

  // Speak assistant messages when voice is enabled
  const lastMsgCount = useRef(0);
  useEffect(() => {
    if (messages.length > lastMsgCount.current) {
      const latest = messages[messages.length - 1];
      if (latest.role === 'assistant' && voice.voiceEnabled) {
        voice.speak(latest.content);
      }
    }
    lastMsgCount.current = messages.length;
  }, [messages.length, voice.voiceEnabled, voice.speak, messages]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (messagesEndRef.current && typeof messagesEndRef.current.scrollIntoView === 'function') {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length, isPending]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  return (
    <div className="flex flex-col h-[calc(100vh-220px)] max-h-[800px]">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b mb-4">
        <div className="flex items-center gap-3">
          <Bot className="w-6 h-6 text-primary" />
          <div>
            <h2 className="text-lg font-semibold">
              Chat{personality ? ` with ${personality.name}` : ''}
            </h2>
            {personality && (
              <p className="text-xs text-muted-foreground">{personality.description}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <VoiceToggle
            voiceEnabled={voice.voiceEnabled}
            isListening={voice.isListening}
            isSpeaking={voice.isSpeaking}
            supported={voice.supported}
            onToggle={voice.toggleVoice}
          />
          <div className="relative">
            <button
              onClick={() => setShowModelWidget((v) => !v)}
              className="btn-ghost text-xs px-3 py-1.5 rounded-full border"
            >
              Model Info
            </button>
            {showModelWidget && (
              <div className="absolute right-0 top-full mt-2 z-50">
                <ModelWidget onClose={() => setShowModelWidget(false)} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-4 pb-4">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <div className="text-center">
              <Bot className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">
                Start a conversation{personality ? ` with ${personality.name}` : ''}.
              </p>
              <p className="text-xs mt-1">Messages are session-only and not persisted.</p>
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[75%] rounded-lg px-4 py-3 ${
                msg.role === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                {msg.role === 'user' ? (
                  <User className="w-3 h-3" />
                ) : (
                  <Bot className="w-3 h-3" />
                )}
                <span className="text-xs opacity-70">
                  {msg.role === 'user' ? 'You' : personality?.name ?? 'Assistant'}
                </span>
                {msg.model && (
                  <span className="text-xs opacity-50">
                    {msg.model}
                  </span>
                )}
              </div>
              <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
              {msg.tokensUsed !== undefined && (
                <p className="text-xs opacity-50 mt-1">{msg.tokensUsed} tokens</p>
              )}
            </div>
          </div>
        ))}

        {/* Typing indicator */}
        {isPending && (
          <div className="flex justify-start">
            <div className="bg-muted rounded-lg px-4 py-3">
              <div className="flex items-center gap-2">
                <Bot className="w-3 h-3" />
                <span className="text-xs opacity-70">{personality?.name ?? 'Assistant'}</span>
              </div>
              <div className="flex gap-1 mt-2">
                <span className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="border-t pt-4">
        <div className="flex gap-3">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Message ${personality?.name ?? 'the assistant'}...`}
            disabled={isPending}
            rows={1}
            className="flex-1 resize-none rounded-lg border bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isPending}
            className="btn-primary px-4 py-3 rounded-lg disabled:opacity-50"
          >
            {isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
