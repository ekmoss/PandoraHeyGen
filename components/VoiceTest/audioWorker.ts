// Audio processing WebWorker
// This worker handles intensive audio processing tasks to free up the main thread

// Use self type that works in worker context
declare const self: {
  onmessage: (event: MessageEvent) => void;
  postMessage: (message: any) => void;
};

// Message types for worker communication
export interface AudioWorkerInput {
  type: "PROCESS_AUDIO";
  chunks: ArrayBuffer[]; // Audio chunks as array buffers
  mimeType: string; // Original MIME type
  isLastChunk: boolean; // Whether this is the final chunk
}

export interface AudioWorkerOutput {
  type: "PROCESSED_AUDIO";
  audioBlob: Blob; // Processed audio as Blob (not ArrayBuffer)
  processingTime: number; // Time taken to process
  mimeType: string; // Output MIME type
  isLastChunk: boolean; // Whether this was the final chunk
}

// Cache for format detection to improve performance
const formatCache = new Map<string, string>();

// Detect audio format from MIME type with caching
function detectAudioFormatCached(mimeType: string): string {
  // Check cache first for better performance
  if (formatCache.has(mimeType)) {
    return formatCache.get(mimeType)!;
  }

  // Perform detection
  let extension = "webm"; // Default

  if (mimeType.includes("audio/")) {
    if (mimeType.includes("wav") || mimeType.includes("x-wav")) {
      extension = "wav";
    } else if (mimeType.includes("mpeg") || mimeType.includes("mp3")) {
      extension = "mp3";
    } else if (mimeType.includes("ogg")) {
      extension = "ogg";
    } else if (mimeType.includes("aac") || mimeType.includes("mp4")) {
      extension = "m4a";
    }
  }

  // Cache the result
  formatCache.set(mimeType, extension);

  return extension;
}

// Ultra-optimized audio processing
function optimizeAudioBlob(
  chunks: ArrayBuffer[],
  mimeType: string,
  isLastChunk: boolean
): { blob: Blob; mimeType: string } {
  const startTime = performance.now();

  // For empty chunks, return minimal empty blob
  if (chunks.length === 0) {
    return {
      blob: new Blob([], { type: "audio/mpeg" }),
      mimeType: "audio/mpeg",
    };
  }

  // For single small chunk, return as is to avoid overhead
  if (chunks.length === 1 && chunks[0].byteLength < 10000) {
    return {
      blob: new Blob([chunks[0]], { type: mimeType || "audio/mpeg" }),
      mimeType: mimeType || "audio/mpeg",
    };
  }

  // For final chunks, prioritize quality over speed if needed
  const outputMimeType = isLastChunk ? "audio/mpeg" : mimeType;

  // Create a Blob from the array buffers
  const blob = new Blob(chunks, { type: outputMimeType });

  // For debugging
  console.log(
    `[Worker] Processed ${chunks.length} chunks (${blob.size} bytes) in ${performance.now() - startTime}ms`
  );

  return {
    blob,
    mimeType: outputMimeType,
  };
}

// WebWorker message handler
self.onmessage = async (event: MessageEvent<AudioWorkerInput>) => {
  const { type, chunks, mimeType, isLastChunk } = event.data;

  if (type === "PROCESS_AUDIO") {
    const startTime = performance.now();

    try {
      // Process audio with optimized algorithm
      const result = optimizeAudioBlob(chunks, mimeType, isLastChunk);

      // Send processed audio back to main thread
      const response: AudioWorkerOutput = {
        type: "PROCESSED_AUDIO",
        audioBlob: result.blob,
        mimeType: result.mimeType,
        processingTime: performance.now() - startTime,
        isLastChunk,
      };

      // Send the response without transferables (Blob is not transferable)
      self.postMessage(response);
    } catch (error) {
      console.error("[AudioWorker] Error processing audio:", error);

      // Send error back to main thread
      self.postMessage({
        type: "ERROR",
        error: error instanceof Error ? error.message : "Unknown error",
        isLastChunk,
      });
    }
  }
};
