import { useEffect, useRef, useCallback } from 'react';
import { getApiServerUrl } from '../utils/apiUtils';

interface WebSocketMessage {
  type: string;
  [key: string]: any;
}

export function useWebSocket(onMessage: (message: WebSocketMessage) => void) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const isUnmountedRef = useRef(false);
  const pingIntervalRef = useRef<NodeJS.Timeout>();
  const pongTimeoutRef = useRef<NodeJS.Timeout>();

  const connect = useCallback(() => {
    if (isUnmountedRef.current) return;

    const apiUrl = getApiServerUrl();
    const wsUrl = apiUrl.replace(/^https?/, (match) => match === 'https' ? 'wss' : 'ws');

    try {
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        if (ws !== wsRef.current) return;
        console.log('[WebSocket] 已连接');

        // Start heartbeat
        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));

            // Expect pong within 5 seconds
            pongTimeoutRef.current = setTimeout(() => {
              console.log('[WebSocket] 心跳超时，重连...');
              ws.close();
            }, 5000);
          }
        }, 30000);
      };

      ws.onmessage = (event) => {
        if (ws !== wsRef.current) return;
        try {
          const message = JSON.parse(event.data);

          // Handle pong response
          if (message.type === 'pong') {
            if (pongTimeoutRef.current) {
              clearTimeout(pongTimeoutRef.current);
            }
            return;
          }

          onMessage(message);
        } catch (error) {
          console.error('[WebSocket] 解析消息失败:', error);
        }
      };

      ws.onerror = (error) => {
        if (ws !== wsRef.current) return;
        if (!isUnmountedRef.current) {
          console.error('[WebSocket] 错误:', error);
        }
      };

      ws.onclose = () => {
        if (ws !== wsRef.current) return;
        console.log('[WebSocket] 已断开，5秒后重连...');

        // Clear heartbeat timers
        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
        }
        if (pongTimeoutRef.current) {
          clearTimeout(pongTimeoutRef.current);
        }

        if (!isUnmountedRef.current) {
          reconnectTimeoutRef.current = setTimeout(connect, 5000);
        }
      };

      wsRef.current = ws;
    } catch (error) {
      console.error('[WebSocket] 连接失败:', error);
      if (!isUnmountedRef.current) {
        reconnectTimeoutRef.current = setTimeout(connect, 5000);
      }
    }
  }, [onMessage]);

  useEffect(() => {
    isUnmountedRef.current = false;

    // Use a small timeout to debounce the connection.
    // In Strict Mode, the component mounts, unmounts, and mounts again immediately.
    // This delay ensures we don't open a socket during the first (temporary) mount,
    // avoiding the "WebSocket is closed before the connection is established" warning
    // when that first socket is immediately closed.
    const startTimeout = setTimeout(() => {
      if (!isUnmountedRef.current) {
        connect();
      }
    }, 100);

    return () => {
      isUnmountedRef.current = true;
      clearTimeout(startTimeout);

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
      }
      if (pongTimeoutRef.current) {
        clearTimeout(pongTimeoutRef.current);
      }
      if (wsRef.current) {
        // 防止关闭正在连接中的 socket 导致浏览器控制台报错
        // 但 Strict Mode 下不可避免会触发 "closed before established"
        wsRef.current.close();
      }
    };
  }, [connect]);

  return wsRef;
}
