import { useCallback, useRef, useState } from 'react';
import { getSupabase } from '@/lib/supabase';

export interface StreamingMessage {
  chunk?: string;
  done?: boolean;
  text?: string;
  handoff?: boolean;
  mediaLabels?: string[];
  error?: string;
}

export function useAiMessageStream() {
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const stream = useCallback(
    async (messageId: string, onChunk: (message: StreamingMessage) => void) => {
      setIsStreaming(true);
      setError(null);
      abortRef.current = new AbortController();

      try {
        const supabase = getSupabase();
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) throw new Error('Not authenticated');

        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-ai-message-stream`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ message_id: messageId }),
            signal: abortRef.current.signal,
          }
        );

        if (!response.ok) {
          const err = await response.text();
          throw new Error(`Stream error ${response.status}: ${err}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No readable stream');

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value);
          const lines = buffer.split('\n');
          buffer = lines[lines.length - 1]; // Retain incomplete line

          for (let i = 0; i < lines.length - 1; i++) {
            const line = lines[i].trim();
            if (line.startsWith('data: ')) {
              const dataStr = line.slice(6);
              try {
                const data = JSON.parse(dataStr);
                onChunk(data);
              } catch {
                // Malformed JSON, skip
              }
            }
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          setError(err.message);
          onChunk({ error: err.message });
        }
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    []
  );

  const cancel = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
      setIsStreaming(false);
    }
  }, []);

  return { stream, isStreaming, error, cancel };
}
