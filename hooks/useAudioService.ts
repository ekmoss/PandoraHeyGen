import { useState, useEffect, useRef, useCallback } from "react";
import {
  AudioService,
  AudioConfig,
  SessionInfo,
} from "@/services/AudioService";

interface UseAudioServiceProps {
  config?: Partial<AudioConfig>;
  onDataAvailable?: (blob: Blob) => void;
  onStart?: () => void;
  onStop?: () => void;
  onError?: (error: Error) => void;
  onSpeechStart?: () => void;
  onSpeechEnd?: (data: { duration: number; isSpeechDetected: boolean }) => void;
  onAudioLevel?: (level: number) => void;
}

interface UseAudioServiceReturn {
  audioService: AudioService;
  isRecording: boolean;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<Blob>;
  currentSession: SessionInfo | null;
  isProcessing: boolean;
  setIsProcessing: (isProcessing: boolean) => void;
  audioChunks: Blob[];
  batchChunks: (chunks: Blob[]) => Blob;
  prepareChunkFormData: (
    audioBlob: Blob,
    isLastChunk?: boolean
  ) => Promise<FormData>;
  shouldProcessWithAI: (text: string) => boolean;
  error: Error | null;
}

/**
 * React hook for using the AudioService in components
 * Provides state management and audio recording functionality
 */
export function useAudioService({
  config,
  onDataAvailable,
  onStart,
  onStop,
  onError,
  onSpeechStart,
  onSpeechEnd,
  onAudioLevel,
}: UseAudioServiceProps = {}): UseAudioServiceReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [audioChunks, setAudioChunks] = useState<Blob[]>([]);
  const [currentSession, setCurrentSession] = useState<SessionInfo | null>(
    null
  );

  // Use a ref to maintain a single instance of the AudioService
  const audioServiceRef = useRef<AudioService | null>(null);

  // Initialize the AudioService
  useEffect(() => {
    // Custom callbacks that update our state
    const callbacks = {
      onDataAvailable: (blob: Blob) => {
        setAudioChunks((prev) => [...prev, blob]);
        onDataAvailable?.(blob);
      },
      onStart: () => {
        setIsRecording(true);
        onStart?.();
      },
      onStop: () => {
        setIsRecording(false);
        onStop?.();
      },
      onError: (err: Error) => {
        setError(err);
        onError?.(err);
      },
      onSpeechStart: onSpeechStart,
      onSpeechEnd: onSpeechEnd,
      onAudioLevel: onAudioLevel,
    };

    // Create new AudioService instance with our configuration and callbacks
    audioServiceRef.current = new AudioService(config, callbacks);

    // Initial session
    const session = audioServiceRef.current.createSession();
    setCurrentSession(session);

    // Cleanup when component unmounts
    return () => {
      if (audioServiceRef.current) {
        audioServiceRef.current.cleanup();
      }
    };
  }, []);

  /**
   * Start recording audio
   */
  const startRecording = useCallback(async () => {
    if (!audioServiceRef.current) {
      throw new Error("AudioService not initialized");
    }

    try {
      setError(null);
      setAudioChunks([]);

      // Start a new recording session
      await audioServiceRef.current.startRecording();

      // Update current session
      const session = audioServiceRef.current.getSession();
      setCurrentSession(session);
    } catch (err) {
      const error =
        err instanceof Error ? err : new Error("Failed to start recording");
      setError(error);
      throw error;
    }
  }, []);

  /**
   * Stop recording and get the audio blob
   */
  const stopRecording = useCallback(async () => {
    if (!audioServiceRef.current) {
      throw new Error("AudioService not initialized");
    }

    try {
      setIsProcessing(true);
      const audioBlob = await audioServiceRef.current.stopRecording();
      return audioBlob;
    } catch (err) {
      const error =
        err instanceof Error ? err : new Error("Failed to stop recording");
      setError(error);
      throw error;
    } finally {
      setIsProcessing(false);
    }
  }, []);

  /**
   * Batch multiple chunks into a single blob
   */
  const batchChunks = useCallback((chunks: Blob[]): Blob => {
    if (!audioServiceRef.current) {
      throw new Error("AudioService not initialized");
    }
    return audioServiceRef.current.batchChunks(chunks);
  }, []);

  /**
   * Prepare form data for a chunk request
   */
  const prepareChunkFormData = useCallback(
    async (audioBlob: Blob, isLastChunk = false): Promise<FormData> => {
      if (!audioServiceRef.current) {
        throw new Error("AudioService not initialized");
      }
      return await audioServiceRef.current.prepareChunkFormData(
        audioBlob,
        isLastChunk
      );
    },
    []
  );

  /**
   * Determine if text is complete enough to send to AI
   */
  const shouldProcessWithAI = useCallback((text: string): boolean => {
    if (!audioServiceRef.current) {
      return false;
    }
    return audioServiceRef.current.shouldProcessWithAI(text);
  }, []);

  return {
    audioService: audioServiceRef.current!,
    isRecording,
    startRecording,
    stopRecording,
    currentSession,
    isProcessing,
    setIsProcessing,
    audioChunks,
    batchChunks,
    prepareChunkFormData,
    shouldProcessWithAI,
    error,
  };
}
