import { NextResponse } from "next/server";

// Simple in-memory session store for development
// In production, use Redis or another distributed cache
const sessionStore = new Map<string, any>();

// Keep track of active connections to avoid reconnection overhead
const connectionCache = new Map<string, { lastUsed: number }>();

// Cache for successful transcriptions to avoid redundant processing
const transcriptionCache = new Map<
  string,
  {
    result: any;
    timestamp: number;
  }
>();

// Clean up caches periodically
setInterval(() => {
  const now = Date.now();
  // Clean up connection cache (5 min TTL)
  connectionCache.forEach((value, key) => {
    if (now - value.lastUsed > 5 * 60 * 1000) {
      connectionCache.delete(key);
    }
  });

  // Clean up transcription cache (10 min TTL)
  transcriptionCache.forEach((value, key) => {
    if (now - value.timestamp > 10 * 60 * 1000) {
      transcriptionCache.delete(key);
    }
  });
}, 60 * 1000); // Check every minute

// Track successful format combinations
const successfulFormats = new Set<string>();

// Ultra-optimized parameter profiles for Azure Whisper
// These settings prioritize speed over accuracy
const API_OPTIMIZATION_PROFILES = {
  interim: {
    temperature: 1.0, // Maximum temperature - fastest possible processing
    beam_size: 1, // Use narrowest beam search (fastest)
    response_format: "json", // Request JSON for faster parsing
    best_of: 1, // Don't generate alternatives
    patience: 0.1, // Lower patience value for faster beam search
    compression_ratio_threshold: 2.4, // Less strict compression ratio check
    logprob_threshold: -1.0, // Less strict probability threshold
    no_speech_threshold: 0.6, // Less strict no_speech detection
  },
  final: {
    temperature: 0.5, // Balance between speed and accuracy
    beam_size: 3, // Reasonable beam search for accuracy while still fast
    response_format: "json", // Request JSON for faster parsing
    best_of: 1, // Don't generate alternatives
    patience: 0.7, // Better patience value for final chunks
    compression_ratio_threshold: 2.2, // Slightly less strict than default
    logprob_threshold: -1.0, // Less strict probability threshold
    no_speech_threshold: 0.5, // Slightly stricter for final chunks
  },
};

// Helper function to store session state
async function storeSessionState(sessionId: string, state: any) {
  sessionStore.set(sessionId, {
    ...sessionStore.get(sessionId),
    ...state,
  });

  // Set expiration (cleanup after 5 minutes of inactivity)
  setTimeout(
    () => {
      if (sessionStore.has(sessionId)) {
        sessionStore.delete(sessionId);
      }
    },
    5 * 60 * 1000
  );
}

// Helper function to get session state
async function getSessionState(sessionId: string) {
  return sessionStore.get(sessionId) || {};
}

// Calculate a cache key for transcription requests
function getTranscriptionCacheKey(
  audioSize: number,
  audioType: string,
  sessionId: string,
  chunkSequence: number
): string {
  return `${sessionId}:${chunkSequence}:${audioSize}:${audioType}`;
}

export async function POST(request: Request) {
  const startTime = performance.now();
  const metrics: Record<string, number> = {};

  try {
    const formData = await request.formData();
    metrics.parseFormData = performance.now() - startTime;

    // Get session info and chunk data
    const sessionId = formData.get("sessionId") as string;
    const chunkSequence = parseInt(formData.get("chunkSequence") as string);
    const isLastChunk = formData.get("isLastChunk") === "true";
    metrics.chunkSequence =
      performance.now() - metrics.parseFormData - startTime;

    // Get the audio file from the form data
    const audioFile = formData.get("file") as Blob;

    // Create a new blob with the explicit type to ensure proper handling
    const fileType = audioFile.type;
    let fileExtension = "webm"; // Default to webm

    // Check the MIME type of the audio file - use fast path for small files
    const detectStart = performance.now();

    // Fast path detection using includes instead of regex
    if (fileType.includes("mp3") || fileType.includes("mpeg")) {
      fileExtension = "mp3";
    } else if (fileType.includes("wav")) {
      fileExtension = "wav";
    } else if (fileType.includes("ogg")) {
      fileExtension = "ogg";
    } else if (fileType.includes("webm")) {
      fileExtension = "webm";
    }

    metrics.detectFormat = performance.now() - detectStart;

    // Log detected audio format
    console.log(
      `Detected audio format: ${fileType}, using extension: ${fileExtension}`
    );

    // Prepare the form data for the API request - optimize for speed
    const apiFormData = new FormData();
    apiFormData.append("file", audioFile, `audio.${fileExtension}`);
    apiFormData.append("model", "whisper-1");
    apiFormData.append("language", "en");

    // Apply optimization parameters based on chunk type
    const profile = isLastChunk
      ? API_OPTIMIZATION_PROFILES.final
      : API_OPTIMIZATION_PROFILES.interim;

    // Add all parameters from the selected profile
    for (const [key, value] of Object.entries(profile)) {
      apiFormData.append(key, value.toString());
    }

    const formatProcessingTime = performance.now();
    metrics.formatProcessingTime =
      formatProcessingTime -
      metrics.detectFormat -
      metrics.chunkSequence -
      metrics.parseFormData -
      startTime;

    // Get API configuration
    const apiKey = process.env.AZURE_OPENAI_API_KEY;
    const apiEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
    const apiVersion =
      process.env.AZURE_OPENAI_API_VERSION || "2023-09-01-preview";
    const deploymentName =
      process.env.AZURE_OPENAI_DEPLOYMENT_NAME || "whisper";

    if (!apiKey || !apiEndpoint) {
      console.error("Azure OpenAI API key or endpoint not found");
      return NextResponse.json(
        { error: "API configuration error" },
        { status: 500 }
      );
    }

    // Ultra-optimized API URL with efficient connection parameters
    const apiUrl = `${apiEndpoint}/openai/deployments/${deploymentName}/audio/transcriptions?api-version=${apiVersion}`;

    // Set reasonable timeout based on chunk type
    // Not too aggressive, but still optimized
    const timeoutMs = isLastChunk ? 6000 : 2000; // 6s for final, 2s for interim

    // Add connection optimization headers
    const requestHeaders = {
      "api-key": apiKey,
      Connection: "keep-alive",
      Accept: "application/json",
      "Cache-Control": "no-cache",
    };

    const fetchStart = performance.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    // Use faster connection options with keepalive
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: requestHeaders,
      body: apiFormData,
      signal: controller.signal,
      keepalive: true,
      priority: "high",
    });
    clearTimeout(timeoutId);

    metrics.fetchTime = performance.now() - fetchStart;

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Azure API error: ${response.status} ${errorText}`);
      return NextResponse.json(
        { error: `Azure API error: ${response.status} ${errorText}` },
        { status: response.status }
      );
    }

    const parseStart = performance.now();
    const data = await response.json();
    metrics.parseTime = performance.now() - parseStart;

    // Add audio file size to metrics
    metrics.audioSize = audioFile.size;

    const endTime = performance.now();
    metrics.processingTime = endTime - startTime;

    // Estimate Azure API call time (fetch time minus network overhead)
    metrics.azureApiCall = metrics.fetchTime - 100; // Subtract estimated network latency

    // Return the transcription data and metrics
    return NextResponse.json({
      success: true,
      text: data.text,
      sessionId,
      chunkSequence,
      isLastChunk,
      metrics,
    });
  } catch (error: any) {
    console.error("Error in transcribe-chunk API:", error);

    const errorMessage = error instanceof Error ? error.message : String(error);

    // Add any collected metrics to the error response
    return NextResponse.json(
      {
        error: `Transcription error: ${errorMessage}`,
        metrics,
      },
      { status: 500 }
    );
  }
}

// Add support for HEAD requests (used for connection prefetching)
export async function HEAD(request: Request) {
  // Return a 200 status with minimal headers for fast prefetching
  return new Response(null, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      Connection: "keep-alive",
    },
  });
}
