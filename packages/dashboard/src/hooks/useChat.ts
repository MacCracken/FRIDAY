import React, { useState, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { sendChatMessage } from '../api/client';
import type { ChatMessage } from '../types';

export interface UseChatOptions {
  personalityId?: string | null;
}

export interface UseChatReturn {
  messages: ChatMessage[];
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  handleSend: () => void;
  isPending: boolean;
  clearMessages: () => void;
}

export function useChat(options?: UseChatOptions): UseChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');

  const chatMutation = useMutation({
    mutationFn: sendChatMessage,
    onSuccess: (response) => {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: response.content,
          timestamp: Date.now(),
          model: response.model,
          provider: response.provider,
          tokensUsed: response.tokensUsed,
        },
      ]);
    },
    onError: (error: Error) => {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `Error: ${error.message}`,
          timestamp: Date.now(),
        },
      ]);
    },
  });

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || chatMutation.isPending) return;

    const userMessage: ChatMessage = {
      role: 'user',
      content: trimmed,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');

    const history = [...messages, userMessage].map((m) => ({
      role: m.role,
      content: m.content,
    }));

    chatMutation.mutate({
      message: trimmed,
      history: history.slice(0, -1),
      ...(options?.personalityId ? { personalityId: options.personalityId } : {}),
    });
  }, [input, messages, chatMutation, options?.personalityId]);

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  return {
    messages,
    input,
    setInput,
    handleSend,
    isPending: chatMutation.isPending,
    clearMessages,
  };
}
