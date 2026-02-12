/**
 * WebSocket Hook for Real-time Updates
 *
 * Connects to the SecureYeoman gateway for live metrics.
 * Buffers subscription requests when disconnected and replays on reconnect.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getAccessToken } from '../api/client.js';
import type { WebSocketMessage } from '../types.js';

interface UseWebSocketReturn {
  connected: boolean;
  reconnecting: boolean;
  lastMessage: WebSocketMessage | null;
  send: (message: unknown) => void;
  subscribe: (channels: string[]) => void;
  unsubscribe: (channels: string[]) => void;
}

const MAX_QUEUE_SIZE = 100;

export function useWebSocket(path: string): UseWebSocketReturn {
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 5;
  const baseReconnectDelay = 2000;
  const maxReconnectDelay = 30000;

  // Track subscribed channels for re-subscription
  const subscribedChannelsRef = useRef<Set<string>>(new Set());
  // Queue messages while disconnected
  const messageQueueRef = useRef<unknown[]>([]);

  const connect = useCallback(() => {
    // Build WebSocket URL with auth token as query param
    // (browser WebSocket API does not support custom headers)
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const token = getAccessToken();
    const params = token ? `?token=${encodeURIComponent(token)}` : '';
    const url = `${protocol}//${host}${path}${params}`;

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        console.debug('WebSocket connected');
        setConnected(true);
        setReconnecting(false);
        reconnectAttempts.current = 0;

        // Re-subscribe to previously tracked channels
        const channels = Array.from(subscribedChannelsRef.current);
        if (channels.length > 0) {
          ws.send(
            JSON.stringify({
              type: 'subscribe',
              payload: { channels },
            })
          );
        } else {
          // Default subscriptions
          ws.send(
            JSON.stringify({
              type: 'subscribe',
              payload: { channels: ['metrics', 'tasks', 'security'] },
            })
          );
          subscribedChannelsRef.current = new Set(['metrics', 'tasks', 'security']);
        }

        // Flush queued messages
        const queue = messageQueueRef.current.splice(0);
        for (const msg of queue) {
          ws.send(JSON.stringify(msg));
        }
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as WebSocketMessage;
          setLastMessage(message);
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };

      ws.onclose = (event) => {
        setConnected(false);
        wsRef.current = null;

        // Attempt to reconnect with capped exponential backoff
        if (reconnectAttempts.current < maxReconnectAttempts) {
          setReconnecting(true);
          const delay = Math.min(
            baseReconnectDelay * Math.pow(2, reconnectAttempts.current),
            maxReconnectDelay,
          );
          console.debug(`WebSocket closed (${event.code}), retrying in ${(delay / 1000).toFixed(0)}s (${reconnectAttempts.current + 1}/${maxReconnectAttempts})`);

          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttempts.current++;
            connect();
          }, delay);
        } else {
          console.warn('WebSocket: max reconnect attempts reached, falling back to polling');
          setReconnecting(false);
        }
      };

      ws.onerror = () => {
        // Suppress noisy console errors — onclose handles reconnection
      };
    } catch (error) {
      console.error('Failed to create WebSocket:', error);
    }
  }, [path]);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  const send = useCallback((message: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    } else {
      // Queue the message if disconnected
      if (messageQueueRef.current.length < MAX_QUEUE_SIZE) {
        messageQueueRef.current.push(message);
      }
    }
  }, []);

  const subscribe = useCallback(
    (channels: string[]) => {
      for (const ch of channels) {
        subscribedChannelsRef.current.add(ch);
      }
      send({
        type: 'subscribe',
        payload: { channels },
      });
    },
    [send]
  );

  const unsubscribe = useCallback(
    (channels: string[]) => {
      for (const ch of channels) {
        subscribedChannelsRef.current.delete(ch);
      }
      send({
        type: 'unsubscribe',
        payload: { channels },
      });
    },
    [send]
  );

  return {
    connected,
    reconnecting,
    lastMessage,
    send,
    subscribe,
    unsubscribe,
  };
}
