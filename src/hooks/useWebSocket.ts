import { useEffect, useRef, useCallback } from 'react';
import { getApiServerUrl } from '../utils/apiUtils';

interface WebSocketMessage {
  type: string;
  [key: string]: any;
}

export function useWebSocket(onMessage: (message: WebSocketMessage) => void) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();

  const connect = useCallback(() => {
    const apiUrl = getApiServerUrl();
    const wsUrl = apiUrl.replace(/^http/, 'ws');

    try {
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('[WebSocket] 已连接');
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          onMessage(message);
        } catch (error) {
          console.error('[WebSocket] 解析消息失败:', error);
        }
      };

      ws.onerror = (error) => {
        console.error('[WebSocket] 错误:', error);
      };

      ws.onclose = () => {
        console.log('[WebSocket] 已断开，5秒后重连...');
        reconnectTimeoutRef.current = setTimeout(connect, 5000);
      };

      wsRef.current = ws;
    } catch (error) {
      console.error('[WebSocket] 连接失败:', error);
      reconnectTimeoutRef.current = setTimeout(connect, 5000);
    }
  }, [onMessage]);

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

  return wsRef;
}
