import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { getAccessToken } from '../api/axios';

export const useSocket = (onClassified, onFailed) => {
  const socketRef = useRef(null);
  const onClassifiedRef = useRef(onClassified);
  const onFailedRef = useRef(onFailed);

  // keep refs updated without reconnecting
  useEffect(() => {
    onClassifiedRef.current = onClassified;
  }, [onClassified]);

  useEffect(() => {
    onFailedRef.current = onFailed;
  }, [onFailed]);

  useEffect(() => {
    if (socketRef.current) return;

    socketRef.current = io(import.meta.env.VITE_SOCKET_URL || 'http://localhost:8000', {
      auth: { token: getAccessToken() },
      reconnection: true,
    });

    socketRef.current.on('request:classified', (data) => onClassifiedRef.current(data));
    socketRef.current.on('request:failed', (data) => onFailedRef.current(data));

    return () => {
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, []);
};