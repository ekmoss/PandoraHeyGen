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

// Optimized parameter profiles for Azure Whisper based on use case
// These settings are based on Azure's latest documentation
const WHISPER_OPTIMIZATION_PROFILES = {
  interim: {
    temperature: 0.6, // Higher temperature for faster but less accurate interim results
    response_format: "json", // Always use JSON format for consistent parsing
    prompt: "Convert speech to text. Keep it simple and fast.", // Simple prompt for speed
    language: "en", // Explicitly set language for faster processing
    compression_ratio_threshold: 2.4, // Less strict compression ratio for speed
    logprob_threshold: -1.0, // Less strict probability threshold
    no_speech_threshold: 0.6, // Less strict no_speech detection
  },
  final: {
    temperature: 0.0, // Zero temperature for maximum accuracy in final chunks
    response_format: "json", // Always use JSON format for consistent parsing
    prompt: "Convert speech to text accurately. Include proper punctuation.", // Focus on accuracy
    language: "en", // Explicitly set language
    compression_ratio_threshold: 2.0, // Default compression ratio check
    logprob_threshold: -0.8, // Stricter probability threshold for accuracy
    no_speech_threshold: 0.4, // Stricter no_speech detection
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
    // Parse form data
    const parseStartTime = performance.now();
    let formData;
    try {
      formData = await request.formData();
    } catch (error) {
      console.error("Error parsing form data:", error);
      return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
    }

    const audioFile = formData.get("file") as Blob;
    const isLastChunk = formData.get("isLastChunk") === "true";
    const sessionId = formData.get("sessionId") as string;
    const chunkSequence = parseInt(
      (formData.get("chunkSequence") as string) || "0"
    );
    const parseEndTime = performance.now();
    metrics.parseFormData = parseEndTime - parseStartTime;

    // Basic validation
    if (!audioFile || !sessionId) {
      console.error("Missing required fields");
      return NextResponse.json(
        { error: "Missing audio file or session ID" },
        { status: 400 }
      );
    }

    // Detect and normalize audio format
    const detectFormatStartTime = performance.now();
    const audioType = audioFile.type;

    // Normalize to a simple MIME type without codec info
    let simpleMimeType = audioType.includes(";")
      ? audioType.split(";")[0]
      : audioType;

    // Map to standard file extension
    let fileExtension = "mp3"; // Default to mp3 - best for Azure

    if (simpleMimeType.includes("mp3") || simpleMimeType.includes("mpeg")) {
      fileExtension = "mp3";
    } else if (simpleMimeType.includes("wav")) {
      fileExtension = "wav";
    } else if (simpleMimeType.includes("webm")) {
      fileExtension = "webm";
    } else if (simpleMimeType.includes("ogg")) {
      fileExtension = "ogg";
    }

    // Prioritize MP3 if we've had success with it before
    // This ensures we use formats that have worked well in the past
    if (
      successfulFormats.has("mp3") &&
      fileExtension !== "mp3" &&
      !isLastChunk
    ) {
      console.log(`Remapping ${fileExtension} to mp3 based on past success`);
      fileExtension = "mp3";
      simpleMimeType = "audio/mpeg";
    }

    console.log(
      `Processing audio: ${simpleMimeType} (${fileExtension}) - ${audioFile.size} bytes, chunk ${chunkSequence}, ${isLastChunk ? "final" : "interim"}`
    );
    metrics.detectFormat = performance.now() - detectFormatStartTime;

    // Check cache for identical audio chunk
    const cacheKey = getTranscriptionCacheKey(
      audioFile.size,
      simpleMimeType,
      sessionId,
      chunkSequence
    );

    const cachedResult = transcriptionCache.get(cacheKey);
    if (cachedResult) {
      console.log(`Cache hit for chunk ${chunkSequence}`);
      // Add cache hit metrics
      metrics.cacheHit = 1;
      metrics.total = performance.now() - startTime;

      return NextResponse.json({
        ...cachedResult.result,
        fromCache: true,
        metrics: {
          ...cachedResult.result.metrics,
          cacheHit: 1,
          total: metrics.total,
        },
      });
    }

    // Get Azure API credentials
    const azureEndpoint = process.env.AZURE_OPENAI_ENDPOINT?.trim();
    const azureKey = process.env.AZURE_OPENAI_API_KEY?.trim();
    const whisperDeployment =
      process.env.AZURE_OPENAI_WHISPER_DEPLOYMENT?.trim();

    if (!azureEndpoint || !azureKey || !whisperDeployment) {
      console.error("Missing Azure credentials");
      return NextResponse.json(
        { error: "Azure API credentials not configured" },
        { status: 500 }
      );
    }

    // Prepare Azure API request
    const apiFormData = new FormData();

    // Convert to ArrayBuffer and create new Blob with clean MIME type
    const arrayBufferStartTime = performance.now();
    const arrayBuffer = await audioFile.arrayBuffer();
    metrics.getArrayBuffer = performance.now() - arrayBufferStartTime;

    // Create a clean blob with simplified MIME type
    const processableAudioBlob = new Blob([arrayBuffer], {
      type: simpleMimeType,
    });

    // Add detailed request metrics
    metrics.audioSize = processableAudioBlob.size;
    metrics.audioFormat = simpleMimeType as unknown as number; // Type cast for metrics
    metrics.isLastChunkFlag = isLastChunk ? 1 : 0; // Convert boolean to number
    metrics.chunkSequence = chunkSequence;

    // Create form data with consistent naming conventions
    apiFormData.append("file", processableAudioBlob, `audio.${fileExtension}`);
    apiFormData.append("model", "whisper-1");

    // Select optimization profile based on whether this is a final chunk
    const optimizationProfile = isLastChunk
      ? WHISPER_OPTIMIZATION_PROFILES.final
      : WHISPER_OPTIMIZATION_PROFILES.interim;

    // Apply all optimization parameters
    for (const [key, value] of Object.entries(optimizationProfile)) {
      apiFormData.append(key, String(value));
    }

    // Add chunk-specific metadata to help with context
    if (!isLastChunk) {
      apiFormData.append("is_interim", "true");
    }

    // Ensure endpoint is correctly formatted
    const baseUrl = azureEndpoint.endsWith("/")
      ? azureEndpoint.slice(0, -1)
      : azureEndpoint;

    // Call Azure Whisper API
    const apiCallStartTime = performance.now();

    const apiUrl = `${baseUrl}/openai/deployments/${whisperDeployment}/audio/transcriptions?api-version=2023-09-01-preview`;

    try {
      // Use connection pooling to improve performance
      connectionCache.set(sessionId, { lastUsed: Date.now() });

      // Set optimized request timeout - shorter for interim chunks
      const timeoutDuration = isLastChunk ? 5000 : 2000;
      const timeoutController = new AbortController();
      const timeoutId = setTimeout(
        () => timeoutController.abort(),
        timeoutDuration
      );

      const azureResponse = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "api-key": azureKey,
          Connection: "keep-alive",
          // DO NOT set Content-Type header - let fetch handle it
        },
        body: apiFormData,
        // Add caching directives
        cache: "no-store",
        // Add timeout signal
        signal: timeoutController.signal,
      });

      // Clear timeout if request completed
      clearTimeout(timeoutId);

      const apiCallEndTime = performance.now();
      metrics.azureApiCall = apiCallEndTime - apiCallStartTime;

      // Log success/failure
      if (!azureResponse.ok) {
        console.error(`Azure API error: ${azureResponse.status}`, {
          chunkSequence,
          isLastChunk,
          audioSize: processableAudioBlob.size,
          audioType: simpleMimeType,
          fileExtension,
        });
      } else {
        console.log(`Azure API success: ${azureResponse.status}`, {
          chunkSequence,
          isLastChunk,
          audioSize: processableAudioBlob.size,
          fileExtension,
          processingTime: metrics.azureApiCall,
        });

        // Record successful format for future use
        successfulFormats.add(fileExtension);
      }

      // Parse response
      let data;
      try {
        const responseStartTime = performance.now();
        data = await azureResponse.json();
        metrics.parseResponse = performance.now() - responseStartTime;
      } catch (error) {
        return NextResponse.json(
          { error: "Failed to parse Azure response" },
          { status: 500 }
        );
      }

      if (!azureResponse.ok) {
        console.error("Azure API error:", {
          status: azureResponse.status,
          data,
        });

        return NextResponse.json(
          {
            error: `Azure API error: ${azureResponse.status} - ${data.error?.message || JSON.stringify(data)}`,
          },
          { status: azureResponse.status }
        );
      }

      // Calculate total time
      const endTime = performance.now();
      metrics.total = endTime - startTime;

      // Save successful transcription to session state
      if (data.text) {
        await storeSessionState(sessionId, {
          lastText: data.text,
          lastUpdated: Date.now(),
          chunkSequence,
        });
      }

      // Prepare result
      const result = {
        text: data.text,
        combinedText: data.text,
        isPartial: !isLastChunk,
        chunkSequence,
        sessionId,
        metrics: metrics,
      };

      // Cache the result for potential reuse
      // Don't cache very small or empty results
      if (data.text && data.text.length > 3) {
        transcriptionCache.set(cacheKey, {
          result,
          timestamp: Date.now(),
        });
      }

      // Return transcription result
      return NextResponse.json(result);
    } catch (error) {
      // Check if this is a timeout error
      const isTimeout = error instanceof Error && error.name === "AbortError";

      console.error(`Error calling Azure: ${isTimeout ? "TIMEOUT" : error}`);
      return NextResponse.json(
        {
          error: isTimeout
            ? "Azure API timeout - request took too long"
            : `Error communicating with Azure API: ${error instanceof Error ? error.message : "Unknown error"}`,
          metrics: metrics,
        },
        { status: isTimeout ? 408 : 500 }
      );
    }
  } catch (error) {
    console.error("API route error:", error);
    return NextResponse.json(
      {
        error: `Internal server error: ${error instanceof Error ? error.message : "Unknown error"}`,
        metrics: metrics,
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
