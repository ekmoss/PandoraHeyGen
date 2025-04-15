import { v4 as uuidv4 } from "uuid";

/**
 * Configuration for streaming audio processing
 */
export interface StreamingAudioConfig {
  chunkDuration: number; // How often to create chunks in ms
  minChunkSize: number; // Minimum size in bytes for a chunk to be processed
  audioBitsPerSecond: number; // Audio quality
  mimeType: string; // Audio format
  sessionTimeout: number; // How long to maintain session state in ms
  vadEnabled: boolean; // Whether to use voice activity detection
  vadSensitivity: number; // Sensitivity for voice detection (0-1, higher is more sensitive)
  processingTimeout: number; // Timeout for processing requests in ms
}

/**
 * Default configuration for streaming audio
 */
export const DEFAULT_STREAMING_CONFIG: StreamingAudioConfig = {
  chunkDuration: 250, // Reduce from 300ms to 250ms for more frequent chunks
  minChunkSize: 800, // Reduce from 1200 to 800 to process more chunks
  audioBitsPerSecond: 24000, // Reduce from 32kbps to 24kbps - better speed/quality balance
  mimeType: "audio/mp3", // Use MP3 as the preferred format for Azure compatibility
  sessionTimeout: 5 * 60 * 1000, // 5 minutes
  vadEnabled: false, // Disable VAD by default as it may add latency
  vadSensitivity: 0.7, // Medium-high sensitivity (0-1)
  processingTimeout: 2000, // Reduce timeout from 3s to 2s for faster error detection
};

/**
 * Session information for associating audio chunks
 */
export interface SessionInfo {
  sessionId: string;
  createdAt: number;
  lastUpdated: number;
  chunkSequence: number;
}

/**
 * Result from processing an audio chunk
 */
export interface ChunkProcessingResult {
  text: string;
  combinedText?: string;
  isPartial: boolean;
  chunkSequence: number;
  sessionId: string;
  metrics?: Record<string, number>;
  error?: string;
}

/**
 * Represents the result of a transcription operation
 */
export interface TranscriptionResult {
  text: string;
  combinedText: string;
  isPartial: boolean;
  chunkSequence: number;
  sessionId: string;
  metrics?: Record<string, number>;
  error?: string;
}

/**
 * Creates a new streaming audio session
 */
export function createStreamingSession(): SessionInfo {
  return {
    sessionId: uuidv4(),
    createdAt: Date.now(),
    lastUpdated: Date.now(),
    chunkSequence: 0,
  };
}

/**
 * Prepares form data for a chunk request
 */
export function prepareChunkFormData(
  audioBlob: Blob,
  sessionId: string,
  chunkSequence: number,
  isLastChunk: boolean = false
): FormData {
  const formData = new FormData();

  // Don't attempt format conversion here - just pass the blob as-is
  // The server will handle format detection and conversion
  formData.append(
    "file",
    audioBlob,
    `audio.${getExtensionFromMimeType(audioBlob.type)}`
  );
  formData.append("sessionId", sessionId);
  formData.append("chunkSequence", chunkSequence.toString());
  formData.append("isLastChunk", isLastChunk.toString());

  return formData;
}

/**
 * Helper to determine the file extension from MIME type
 */
export function getExtensionFromMimeType(mimeType: string): string {
  // Strip codec information if present
  const baseMimeType = mimeType.includes(";")
    ? mimeType.split(";")[0]
    : mimeType;

  if (baseMimeType.includes("webm")) return "webm";
  if (baseMimeType.includes("wav")) return "wav";
  if (baseMimeType.includes("mp3") || baseMimeType.includes("mpeg"))
    return "mp3";
  if (baseMimeType.includes("ogg")) return "ogg";
  if (baseMimeType.includes("mp4")) return "mp4";
  if (baseMimeType.includes("m4a")) return "m4a";

  // Default to webm as it's our preferred format
  console.log(`Unknown MIME type: ${mimeType}, defaulting to webm`);
  return "webm";
}

/**
 * Configure a MediaRecorder for streaming
 */
export function configureMediaRecorder(
  stream: MediaStream,
  config: StreamingAudioConfig = DEFAULT_STREAMING_CONFIG
): MediaRecorder {
  return new MediaRecorder(stream, {
    mimeType: config.mimeType,
    audioBitsPerSecond: config.audioBitsPerSecond,
  });
}

/**
 * Determine if an audio chunk is large enough to process
 */
export function isChunkProcessable(
  chunk: Blob,
  minSize: number = DEFAULT_STREAMING_CONFIG.minChunkSize
): boolean {
  return chunk.size >= minSize;
}

/**
 * Detect if audio contains speech (basic implementation)
 * In a production environment, use a proper VAD algorithm with WebAudio API
 */
export function detectVoiceActivity(
  audioBuffer: Blob,
  sensitivity: number = DEFAULT_STREAMING_CONFIG.vadSensitivity
): Promise<boolean> {
  return new Promise((resolve) => {
    // If VAD is disabled or this is a large chunk, assume it contains speech
    if (
      !DEFAULT_STREAMING_CONFIG.vadEnabled ||
      audioBuffer.size > DEFAULT_STREAMING_CONFIG.minChunkSize * 2
    ) {
      resolve(true);
      return;
    }

    // This is a simplified approach
    // A real implementation would analyze the audio data using WebAudio API
    // For now, we'll use size as a simple heuristic combined with our sensitivity parameter
    const sizeThreshold =
      DEFAULT_STREAMING_CONFIG.minChunkSize * (1 - sensitivity);
    resolve(audioBuffer.size >= sizeThreshold);
  });
}

/**
 * Determine if text is complete enough to send to AI
 */
export function shouldProcessWithAI(text: string): boolean {
  // Check for sentence endings or clear pauses
  // Added more comprehensive conditions for better detection
  if (text.length < 2) return false;

  // Process if there's a sentence ending
  if (text.match(/[.!?]$/)) return true;

  // Process if it's a question (even without punctuation)
  if (
    text
      .toLowerCase()
      .match(
        /^(who|what|when|where|why|how|is|are|can|could|would|will|should)/
      )
  ) {
    return text.length > 10;
  }

  // Process if long enough to likely be a complete thought
  return text.length > 20;
}

// Helper function for format conversion if needed
async function ensureSupportedFormat(audioBlob: Blob): Promise<Blob> {
  // If the audio is already in a supported format, just return it
  const supportedFormats = [
    "audio/mp3",
    "audio/mpeg",
    "audio/wav",
    "audio/webm",
  ];
  const baseMimeType = audioBlob.type.split(";")[0];

  if (supportedFormats.includes(baseMimeType)) {
    // For already supported formats, do a quick size check
    // If the blob is too large, we'll create a clean copy with the same type
    if (audioBlob.size > 1000000) {
      // Over 1MB
      console.log(
        `Large ${baseMimeType} blob (${audioBlob.size} bytes), creating optimized copy`
      );
      try {
        const arrayBuffer = await audioBlob.arrayBuffer();
        return new Blob([arrayBuffer], { type: baseMimeType });
      } catch (error) {
        console.error("Error optimizing large blob:", error);
        return audioBlob;
      }
    }
    return audioBlob;
  }

  console.log(
    `Converting from ${audioBlob.type} to MP3 format for better Azure processing`
  );

  try {
    // Get the raw data
    const arrayBuffer = await audioBlob.arrayBuffer();

    // Create a clean MP3 blob as it's best supported by Azure
    return new Blob([arrayBuffer], { type: "audio/mpeg" });
  } catch (error) {
    console.error("Error in audio conversion:", error);
    // Return original blob if conversion fails
    return audioBlob;
  }
}

/**
 * Process an audio chunk with the API
 */
export async function processAudioChunk(
  audioBlob: Blob,
  sessionInfo: SessionInfo,
  isLastChunk: boolean = false,
  config: StreamingAudioConfig = DEFAULT_STREAMING_CONFIG
): Promise<TranscriptionResult> {
  const startTime = performance.now();
  const metrics: Record<string, number> = {};

  try {
    // Skip very small chunks that are likely silence
    if (!isLastChunk && audioBlob.size < config.minChunkSize) {
      console.log(`Skipping small chunk (${audioBlob.size} bytes)`);
      return {
        text: "",
        combinedText: "",
        isPartial: true,
        chunkSequence: sessionInfo.chunkSequence,
        sessionId: sessionInfo.sessionId,
        metrics: { processingTime: performance.now() - startTime },
      };
    }

    // Only process interim chunks if they're large enough to likely contain speech
    // But always process the final chunk
    if (!isLastChunk && audioBlob.size < config.minChunkSize * 1.5) {
      // Skip very small interim chunks to reduce API load
      console.log(
        `Interim chunk too small (${audioBlob.size} bytes), deferring processing`
      );
      return {
        text: "",
        combinedText: "",
        isPartial: true,
        chunkSequence: sessionInfo.chunkSequence,
        sessionId: sessionInfo.sessionId,
        metrics: { processingTime: performance.now() - startTime },
      };
    }

    // Process multiple operations in parallel for better performance:
    // 1. Pre-connect to API to warm up connection
    // 2. Optimize audio format
    const [_, processableAudioBlob] = await Promise.all([
      // Prefetch API connection (ignore errors)
      fetch("/api/transcribe-chunk", {
        method: "HEAD",
        headers: { Connection: "keep-alive" },
      }).catch(() => null),

      // Process audio format in parallel
      optimizeAudioFormat(audioBlob, isLastChunk),
    ]);

    // Log format optimization time
    metrics.formatProcessingTime = performance.now() - startTime;

    // Log detailed audio information for debugging
    console.log(`Processing audio chunk:`, {
      originalSize: audioBlob.size,
      originalType: audioBlob.type,
      processedSize: processableAudioBlob.size,
      processedType: processableAudioBlob.type,
      chunkSequence: sessionInfo.chunkSequence,
      isLastChunk,
    });

    // Create form data with appropriate filename extension based on blob type
    const formData = prepareChunkFormData(
      processableAudioBlob,
      sessionInfo.sessionId,
      sessionInfo.chunkSequence,
      isLastChunk
    );

    // Set appropriate timeout based on chunk type and size
    // Larger final chunks need more time, interim chunks should fail fast
    const timeoutMs = isLastChunk
      ? Math.min(8000, Math.max(5000, processableAudioBlob.size / 100)) // Dynamic timeout for final chunks
      : 2000; // Fixed shorter timeout for interim chunks

    // Call the API with appropriate timeout
    const fetchStartTime = performance.now();
    const response = await fetch("/api/transcribe-chunk", {
      method: "POST",
      body: formData,
      signal: AbortSignal.timeout(timeoutMs),
      // Add connection reuse headers
      headers: {
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        Connection: "keep-alive",
      },
    });
    metrics.fetchTime = performance.now() - fetchStartTime;

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error: ${response.status} - ${errorText}`);
    }

    const parseStartTime = performance.now();
    const result = await response.json();
    metrics.parseTime = performance.now() - parseStartTime;

    metrics.processingTime = performance.now() - startTime;

    console.log(
      `Processed chunk ${sessionInfo.chunkSequence} (${isLastChunk ? "final" : "interim"}) in ${metrics.processingTime.toFixed(2)}ms`
    );

    // For final chunks, we can start processing the AI response in parallel
    // with the UI updates (don't await this)
    if (isLastChunk && result.text && !result.error) {
      // Schedule AI processing for the next event loop tick
      setTimeout(() => {
        try {
          // This will run in the background while the UI updates
          console.log("Starting background AI processing...");
          // The actual AI processing will be handled by the component
          // that receives this result
        } catch (e) {
          // Ignore errors in background processing
        }
      }, 0);
    }

    return {
      ...result,
      metrics: {
        ...result.metrics,
        ...metrics,
      },
    };
  } catch (error) {
    console.error("Error processing audio chunk:", error);
    metrics.processingTime = performance.now() - startTime;

    return {
      text: "",
      combinedText: "",
      isPartial: !isLastChunk,
      error: error instanceof Error ? error.message : "Unknown error",
      chunkSequence: sessionInfo.chunkSequence,
      sessionId: sessionInfo.sessionId,
      metrics,
    };
  }
}

/**
 * Optimize audio format for faster processing
 * Uses different strategies based on whether this is a final chunk
 */
async function optimizeAudioFormat(
  audioBlob: Blob,
  isLastChunk: boolean
): Promise<Blob> {
  // For very small blobs, just return as is
  if (audioBlob.size < 3000) {
    return audioBlob;
  }

  try {
    // Get the raw audio data
    const arrayBuffer = await audioBlob.arrayBuffer();

    // Always convert webm with opus codec to MP3 as Azure has issues with it
    if (audioBlob.type.includes("webm;codecs=opus")) {
      console.log(
        "Converting webm;codecs=opus to MP3 for better Azure compatibility"
      );
      return new Blob([arrayBuffer], { type: "audio/mpeg" });
    }

    // For interim chunks, prioritize speed over quality
    if (!isLastChunk) {
      // For regular WebM (no opus) and OGG, use the original format
      if (audioBlob.type.includes("webm") || audioBlob.type.includes("ogg")) {
        return new Blob([arrayBuffer], { type: audioBlob.type });
      }

      // For other formats, convert to MP3 (best compression/speed ratio)
      return new Blob([arrayBuffer], { type: "audio/mpeg" });
    }

    // For final chunks, use the format that works best with Azure
    // MP3 is generally the most reliable
    const preferredType =
      audioBlob.type.includes("mp3") || audioBlob.type.includes("mpeg")
        ? audioBlob.type // Keep MP3 as is
        : "audio/mpeg"; // Convert others to MP3

    return new Blob([arrayBuffer], { type: preferredType });
  } catch (error) {
    console.error("Error optimizing audio format:", error);
    // Return original on error
    return audioBlob;
  }
}

/**
 * Safely increment the chunk sequence number
 */
export function incrementChunkSequence(sessionInfo: SessionInfo): SessionInfo {
  return {
    ...sessionInfo,
    chunkSequence: sessionInfo.chunkSequence + 1,
    lastUpdated: Date.now(),
  };
}

/**
 * Batch multiple small chunks for more efficient processing
 */
export function batchChunks(chunks: Blob[]): Blob {
  if (chunks.length === 0)
    return new Blob([], { type: DEFAULT_STREAMING_CONFIG.mimeType });
  if (chunks.length === 1) return chunks[0];

  return new Blob(chunks, { type: chunks[0].type });
}

/**
 * Check if a session has timed out
 */
export function isSessionTimedOut(
  sessionInfo: SessionInfo,
  config: StreamingAudioConfig = DEFAULT_STREAMING_CONFIG
): boolean {
  return Date.now() - sessionInfo.lastUpdated > config.sessionTimeout;
}

/**
 * Create a debounced function to avoid excessive processing
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  return function (...args: Parameters<T>): void {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}
