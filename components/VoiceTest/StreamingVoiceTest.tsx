"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { Button, Card, CardBody, Chip, Tooltip } from "@nextui-org/react";
import {
  createStreamingSession,
  configureMediaRecorder,
  processAudioChunk,
  shouldProcessWithAI,
  incrementChunkSequence,
  SessionInfo,
  DEFAULT_STREAMING_CONFIG,
} from "@/app/lib/streamingAudio";
import {
  createVAD,
  isVADSupported,
  detectSilence,
} from "../../app/lib/voiceActivityDetection";

interface StreamingVoiceTestProps {
  onTranscriptionComplete?: (text: string) => void;
}

// Define a type for our performance metrics
interface PerformanceMetric {
  step: string;
  startTime: number;
  endTime: number;
  duration: number;
}

// Define API metrics structure
interface ApiMetrics {
  [key: string]: number;
}

// Define VAD-specific metrics
interface VADMetrics {
  vadToRecordingStartTime?: number;
  vadToRecordingStopTime?: number;
  totalSpeechDuration?: number;
}

export default function StreamingVoiceTest({
  onTranscriptionComplete,
}: StreamingVoiceTestProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recognizedText, setRecognizedText] = useState("");
  const [partialText, setPartialText] = useState("");
  const [response, setResponse] = useState("");

  // Add performance metrics state
  const [metrics, setMetrics] = useState<PerformanceMetric[]>([]);
  const [vadMetrics, setVadMetrics] = useState<VADMetrics>({});
  const [totalLatency, setTotalLatency] = useState<number>(0);

  // Add API metrics state
  const [transcribeMetrics, setTranscribeMetrics] = useState<ApiMetrics | null>(
    null
  );
  const [chatMetrics, setChatMetrics] = useState<ApiMetrics | null>(null);

  // Session state
  const [sessionInfo, setSessionInfo] = useState<SessionInfo>(
    createStreamingSession
  );

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingStartTimeRef = useRef<number>(0);

  // Configuration constants from our utilities
  const { chunkDuration, minChunkSize } = DEFAULT_STREAMING_CONFIG;

  const [usingVAD, setUsingVAD] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const vadRef = useRef<any>(null);

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && isRecording) {
        mediaRecorderRef.current.stop();
      }
    };
  }, [isRecording]);

  // Helper function to log performance metrics
  const logPerformance = useCallback(
    (step: string, startTime: number, endTime: number) => {
      const duration = endTime - startTime;
      setMetrics((prev) => [...prev, { step, startTime, endTime, duration }]);
      return duration;
    },
    []
  );

  // Process transcribed text with AI
  const processTranscribedText = useCallback(
    async (text: string) => {
      const startTime = performance.now();
      try {
        setIsProcessing(true);

        const chatStartTime = performance.now();
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Connection: "keep-alive",
          },
          body: JSON.stringify({ message: text }),
          cache: "no-store",
        });
        const chatEndTime = performance.now();
        logPerformance("OpenAI Chat API Call", chatStartTime, chatEndTime);

        if (!response.ok) {
          throw new Error(`Chat API error: ${response.statusText}`);
        }

        const dataStartTime = performance.now();
        const data = await response.json();
        const dataEndTime = performance.now();
        logPerformance("Parse Chat Response", dataStartTime, dataEndTime);

        // Store API metrics if available
        if (data.metrics) {
          setChatMetrics(data.metrics);
          console.log("Chat API metrics:", data.metrics);
        }

        setResponse(data.message || "No response received");
      } catch (error) {
        console.error("Error processing chat:", error);
        setError(
          `Failed to get AI response: ${error instanceof Error ? error.message : String(error)}`
        );
      } finally {
        const endTime = performance.now();
        logPerformance("Total Chat Processing", startTime, endTime);
        setIsProcessing(false);
      }
    },
    [logPerformance]
  );

  // Handle audio chunk processing results
  const handleChunkResult = useCallback(
    async (result: any) => {
      if (!result) {
        console.warn("Received empty result from audio processing");
        return;
      }

      // Check for errors first
      if (result.error) {
        console.error("Error in chunk processing:", result.error);

        // For interim chunks, don't show UI errors to avoid flickering
        // Only show errors for final chunks or repeated errors
        if (!result.isPartial) {
          // Extract the actual error message from potential Azure error format
          let errorMessage = result.error;

          // Try to extract Azure error message if it's in a stringified JSON format
          if (
            typeof errorMessage === "string" &&
            errorMessage.includes("Azure API error")
          ) {
            try {
              const match = errorMessage.match(
                /Invalid file format\. Supported formats: (.+)\}/
              );
              if (match && match[1]) {
                errorMessage = `Azure API cannot process this audio format. Supported formats: ${match[1]}`;
              }
            } catch (e) {
              // Keep original error if parsing fails
            }
          }

          setError(errorMessage);
        }
        return;
      }

      // Clear any previous errors if we have a successful result
      setError(null);

      // Store API metrics if available
      if (result.metrics) {
        setTranscribeMetrics(result.metrics);
      }

      if (result.text) {
        const text = result.text.trim();

        // Handle partial or final transcriptions
        if (result.isPartial) {
          setPartialText(result.combinedText || text);
        } else {
          setRecognizedText(result.combinedText || text);
          setPartialText("");

          if (onTranscriptionComplete) {
            onTranscriptionComplete(result.combinedText || text);
          }

          // Process with AI if this is final chunk or a complete thought
          if (!result.isPartial && shouldProcessWithAI(text)) {
            await processTranscribedText(result.combinedText || text);
          }
        }
      }

      // Update session info
      setSessionInfo((prevSession) => incrementChunkSequence(prevSession));
    },
    [onTranscriptionComplete, processTranscribedText]
  );

  // Get the best supported MIME type for audio recording
  const getSupportedMimeType = useCallback(() => {
    // Optimal formats in order of preference - MP3 is optimal for Azure processing
    const mimeTypes = [
      "audio/mp3", // Direct MP3 (not widely supported but best if available)
      "audio/mpeg", // MP3 alternative syntax
      "audio/webm;codecs=opus", // Good compression, widely supported
      "audio/webm", // Fallback webm without codec specification
      "audio/ogg;codecs=opus", // Good compression, decent support
      "audio/wav", // Widely supported but inefficient
      "audio/ogg", // Fallback ogg without codec
    ];

    // Find the first supported MIME type
    for (const mimeType of mimeTypes) {
      if (MediaRecorder.isTypeSupported(mimeType)) {
        console.log(`Using supported MIME type: ${mimeType}`);
        return mimeType;
      }
    }

    // Fallback to default if none are supported
    console.warn(
      "None of the preferred MIME types are supported, using default"
    );
    return "audio/webm";
  }, []);

  // Get audio stream with optimized settings
  const getAudioStream = useCallback(async () => {
    const startTime = performance.now();
    try {
      // Request optimal audio settings for speech recognition
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1, // Mono audio (better for speech recognition)
          sampleRate: 16000, // 16kHz sample rate (optimal for Whisper)
          sampleSize: 16, // 16-bit samples (good quality)
          echoCancellation: true, // Reduce echo
          noiseSuppression: true, // Reduce background noise
          autoGainControl: true, // Help normalize audio levels
        },
      });
      const endTime = performance.now();
      logPerformance("Get Audio Stream", startTime, endTime);
      return stream;
    } catch (error) {
      console.error("Error accessing microphone:", error);
      const endTime = performance.now();
      logPerformance("Get Audio Stream (Failed)", startTime, endTime);
      throw new Error(
        "Failed to access microphone. Please ensure microphone permissions are granted."
      );
    }
  }, [logPerformance]);

  // Add this new function to manage VAD
  const setupVAD = (stream: MediaStream) => {
    if (!isVADSupported()) {
      console.warn("Voice Activity Detection is not supported in this browser");
      return null;
    }

    const vad = createVAD(stream, {
      threshold: -50, // Slightly more sensitive than default
      silenceTimeout: 500, // Wait slightly longer for end of speech
    });

    vad.setOnSpeechStart(() => {
      console.log("🎤 Speech detected, starting recording...");
      setIsRecording(true);

      // Start recording immediately when speech is detected
      if (
        mediaRecorderRef.current &&
        mediaRecorderRef.current.state === "inactive"
      ) {
        const startTime = performance.now();
        mediaRecorderRef.current.start(500); // Still chunk every 500ms
        console.log("▶️ Recording started (VAD triggered)");

        // Update metrics
        setVadMetrics((prev) => ({
          ...prev,
          vadToRecordingStartTime: performance.now() - startTime,
        }));
      }
    });

    vad.setOnSpeechEnd((data) => {
      if (data?.isSpeechDetected) {
        console.log(`🔇 Speech ended after ${data.duration.toFixed(0)}ms`);
        setIsRecording(false);

        // Stop recording after speech ends
        if (
          mediaRecorderRef.current &&
          mediaRecorderRef.current.state !== "inactive"
        ) {
          const startTime = performance.now();
          mediaRecorderRef.current.stop();
          console.log("⏹️ Recording stopped (VAD triggered)");

          // Update metrics
          setVadMetrics((prev) => ({
            ...prev,
            vadToRecordingStopTime: performance.now() - startTime,
            totalSpeechDuration: data.duration,
          }));
        }
      } else {
        console.log("🔇 Brief noise detected, ignoring");
      }
    });

    vad.setOnAudioLevel((level) => {
      // Update audio level for visualization (0-1 range)
      setAudioLevel(level);
    });

    return vad;
  };

  // Update the startRecording function to use VAD
  const startRecording = useCallback(async () => {
    try {
      setError(null);
      setIsProcessing(true);
      setResponse(""); // Clear previous response
      setMetrics([]); // Clear previous metrics
      setTranscribeMetrics(null); // Clear previous API metrics
      setChatMetrics(null); // Clear previous API metrics
      setRecognizedText(""); // Clear previous text
      setPartialText(""); // Clear previous partial text

      // Create new session
      setSessionInfo(createStreamingSession());

      const startTime = performance.now();
      recordingStartTimeRef.current = startTime;

      // Pre-fetch API connection to warm up
      try {
        fetch("/api/transcribe-chunk", { method: "HEAD" }).catch(() => {});
        fetch("/api/chat", { method: "HEAD" }).catch(() => {});
      } catch (e) {
        // Ignore errors in prefetch
      }

      const stream = await getAudioStream();

      const initStartTime = performance.now();
      // Determine the best supported mime type
      const supportedMimeType = getSupportedMimeType();

      // Create and configure the media recorder with optimized settings
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: supportedMimeType,
        audioBitsPerSecond: 24000, // 24kbps - better balance of quality and size for speech
      });
      const initEndTime = performance.now();
      logPerformance("Initialize MediaRecorder", initStartTime, initEndTime);

      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      // Collect and selectively process chunks
      mediaRecorder.ondataavailable = async (event) => {
        if (event.data.size > 0) {
          const chunkTime = performance.now();
          audioChunksRef.current.push(event.data);

          console.log(
            `Audio chunk received at ${chunkTime.toFixed(2)}ms, size: ${event.data.size} bytes, type: ${event.data.type}`
          );

          // Only process interim chunks if they're large enough
          if (event.data.size >= minChunkSize * 1.5) {
            try {
              const chunkStart = performance.now();

              // Process the chunk with the latest session info
              const chunkResult = await processAudioChunk(
                event.data,
                sessionInfo,
                false
              );

              const chunkEnd = performance.now();

              logPerformance(
                `Process Interim Chunk (${audioChunksRef.current.length})`,
                chunkStart,
                chunkEnd
              );

              // Only update UI for meaningful results
              if (chunkResult?.error) {
                console.warn(
                  "Error processing interim chunk:",
                  chunkResult.error
                );
                // Don't show interim errors to avoid UI noise
              } else if (chunkResult?.text) {
                await handleChunkResult(chunkResult);
              }
            } catch (error) {
              console.error("Error in chunk processing:", error);
              // Don't show interim errors to the user to avoid flickering
            }
          }
        }
      };

      mediaRecorder.onstop = async () => {
        try {
          const stopTime = performance.now();
          logPerformance("Recording Duration", startTime, stopTime);

          setIsProcessing(true);

          // Log original chunks for debugging
          console.log("Audio chunks collected:", {
            count: audioChunksRef.current.length,
            sizes: audioChunksRef.current.map((chunk) => chunk.size),
            types: audioChunksRef.current.map((chunk) => chunk.type),
            totalSize: audioChunksRef.current.reduce(
              (sum, chunk) => sum + chunk.size,
              0
            ),
          });

          // Helper function to create an optimized audio blob from chunks
          const createOptimizedAudioBlob = async (
            chunks: Blob[],
            mimeType?: string
          ): Promise<Blob> => {
            if (!chunks.length) return new Blob([], { type: "audio/mp3" });

            // Use the detected MIME type from the MediaRecorder or default to MP3
            const baseMimeType = mimeType || "audio/mpeg";

            // For small recordings, preserve the original MIME type
            const totalSize = chunks.reduce(
              (sum, chunk) => sum + chunk.size,
              0
            );
            if (totalSize < 10000) {
              return new Blob(chunks, { type: baseMimeType });
            }

            try {
              // For larger recordings, convert all chunks to ArrayBuffers
              const buffers = await Promise.all(
                chunks.map(async (chunk) => await chunk.arrayBuffer())
              );

              // Concatenate all buffers - this preserves audio quality while
              // ensuring consistent format
              return new Blob(buffers, { type: "audio/mpeg" });
            } catch (error) {
              console.error("Error creating optimized audio blob:", error);
              // Fallback to simple blob creation
              return new Blob(chunks, { type: baseMimeType });
            }
          };

          // Prepare audio blob and chat API connection in parallel
          const blobStartTime = performance.now();

          // Run multiple operations in parallel:
          // 1. Pre-connect to APIs to warm up connections
          // 2. Create the audio blob
          const [_, __, audioBlob] = await Promise.all([
            // Prefetch transcribe API
            fetch("/api/transcribe-chunk", {
              method: "HEAD",
              headers: { Connection: "keep-alive" },
            }).catch(() => null),

            // Prefetch chat API
            fetch("/api/chat", {
              method: "HEAD",
              headers: { Connection: "keep-alive" },
            }).catch(() => null),

            // Create optimized audio blob
            createOptimizedAudioBlob(
              audioChunksRef.current,
              mediaRecorderRef.current?.mimeType
            ),
          ]);

          const blobEndTime = performance.now();
          logPerformance("Create Audio Blob", blobStartTime, blobEndTime);

          console.log(`Final audio blob details:`, {
            size: audioBlob.size,
            type: audioBlob.type,
            isLastChunk: true,
          });

          // Process the combined audio as the final chunk
          const finalStart = performance.now();

          // Create a fresh session object to ensure we have the latest state
          const currentSession = {
            ...sessionInfo,
            chunkSequence: sessionInfo.chunkSequence + 1,
            lastUpdated: Date.now(),
          };

          const result = await processAudioChunk(
            audioBlob,
            currentSession,
            true
          );

          const finalEnd = performance.now();
          logPerformance("Process Final Chunk", finalStart, finalEnd);

          if (result?.error) {
            console.error("Error processing final chunk:", result.error);
            setError(`Error processing audio: ${result.error}`);
          } else if (result) {
            await handleChunkResult(result);
          } else {
            setError("No result returned from audio processing");
          }

          // Calculate total latency
          const endTime = performance.now();
          const totalLatency = endTime - recordingStartTimeRef.current;
          setTotalLatency(totalLatency);
          logPerformance(
            "End-to-End Latency",
            recordingStartTimeRef.current,
            endTime
          );
          console.log(`Total latency: ${totalLatency.toFixed(2)}ms`);
        } catch (error) {
          console.error("Error in stop recording handler:", error);
          setError(
            `Error processing recording: ${error instanceof Error ? error.message : String(error)}`
          );
        } finally {
          setIsProcessing(false);
          stream.getTracks().forEach((track) => track.stop());
        }
      };

      // Start with optimized chunk duration from config
      mediaRecorder.start(chunkDuration);
      const startRecordingEndTime = performance.now();
      logPerformance("Start Recording", startTime, startRecordingEndTime);

      setIsRecording(true);
      setIsProcessing(false);

      // Check if we should use VAD
      if (usingVAD) {
        // Set up VAD but don't start recording yet
        console.log("🎧 VAD mode active - waiting for speech...");
        vadRef.current = setupVAD(stream);
      }
    } catch (error) {
      console.error("Error starting recording:", error);
      setError(
        `Failed to start recording: ${error instanceof Error ? error.message : String(error)}`
      );
      setIsProcessing(false);
    }
  }, [
    getAudioStream,
    getSupportedMimeType,
    handleChunkResult,
    logPerformance,
    sessionInfo,
    usingVAD,
    chunkDuration,
    minChunkSize,
  ]);

  // Stop recording
  const stopRecording = useCallback(() => {
    const stopStartTime = performance.now();
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      const stopEndTime = performance.now();
      logPerformance("Stop Recording Command", stopStartTime, stopEndTime);
      setIsRecording(false);
    }

    // Clean up VAD if it's running
    if (vadRef.current) {
      vadRef.current.stop();
      vadRef.current = null;
    }
  }, [isRecording, logPerformance]);

  // Format time for display
  const formatTime = (ms: number | string | null | undefined) => {
    if (ms === null || ms === undefined) return "N/A";
    const numericValue = typeof ms === "number" ? ms : Number(ms);
    if (isNaN(numericValue)) return "N/A";
    return `${numericValue.toFixed(2)}ms`;
  };

  // Function to save performance logs
  const savePerformanceLogs = useCallback(async () => {
    try {
      setIsProcessing(true);

      // Create a detailed log of all performance metrics
      const timestamp = new Date().toISOString();
      const detailedLog = {
        timestamp,
        clientMetrics: metrics,
        transcriptionMetrics: transcribeMetrics,
        chatMetrics: chatMetrics,
        audioDetails: {
          chunkDuration,
          mimeType: mediaRecorderRef.current?.mimeType || "unknown",
          totalChunks: audioChunksRef.current.length,
          totalLatency,
        },
        transcribedText: recognizedText,
        aiResponse: response,
        error: error,
        totalLatency,
      };

      // Send to server-side API for saving
      const result = await fetch("/test-voice/save-results", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(detailedLog),
      });

      const data = await result.json();

      if (result.ok) {
        setError(null);
        console.log("Performance logs saved:", data.message);
      } else {
        throw new Error(data.error || "Failed to save logs");
      }
    } catch (error) {
      console.error("Error saving performance logs:", error);
      setError(
        `Failed to save logs: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      setIsProcessing(false);
    }
  }, [
    metrics,
    transcribeMetrics,
    chatMetrics,
    totalLatency,
    recognizedText,
    response,
    error,
    chunkDuration,
  ]);

  // Render API metrics table
  const renderApiMetricsTable = (title: string, metrics: ApiMetrics | null) => {
    if (!metrics) return null;

    // Safely calculate total, defaulting to 0 if not present or not a number
    const total = typeof metrics.total === "number" ? metrics.total : 0;

    return (
      <Card className="mt-4">
        <CardBody>
          <h3 className="text-lg font-bold mb-2">{title}:</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr>
                  <th className="px-4 py-2 text-left">Step</th>
                  <th className="px-4 py-2 text-left">Duration</th>
                  <th className="px-4 py-2 text-left">% of Total</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(metrics)
                  .filter(
                    ([key]) =>
                      key !== "total" &&
                      key !== "audioFormat" &&
                      key !== "isLastChunkFlag"
                  )
                  .sort(([, a], [, b]) => {
                    // Safely compare numeric values, defaulting to 0 for non-numbers
                    const numA = typeof a === "number" ? a : 0;
                    const numB = typeof b === "number" ? b : 0;
                    return numB - numA; // Sort by duration descending
                  })
                  .map(([key, value], index) => (
                    <tr key={index} className="border-t">
                      <td className="px-4 py-2">{key}</td>
                      <td className="px-4 py-2">{formatTime(value)}</td>
                      <td className="px-4 py-2">
                        {total > 0
                          ? `${(((typeof value === "number" ? value : 0) / total) * 100).toFixed(1)}%`
                          : "-"}
                      </td>
                    </tr>
                  ))}
                <tr className="border-t font-bold bg-gray-100">
                  <td className="px-4 py-2">Total</td>
                  <td className="px-4 py-2">{formatTime(total)}</td>
                  <td className="px-4 py-2">100%</td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    );
  };

  // Add this function to toggle VAD mode
  const toggleVADMode = () => {
    setUsingVAD(!usingVAD);
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-2xl font-bold">Streaming Voice Processing Test</h1>
      <p className="text-sm text-gray-600 mb-4">
        Testing chunked audio processing with {chunkDuration}ms intervals. Audio
        is processed in real-time as you speak.
      </p>

      <div className="flex gap-2">
        <Button
          color={isRecording ? "danger" : "primary"}
          isLoading={isProcessing}
          onPress={isRecording ? stopRecording : startRecording}
        >
          {isProcessing
            ? "Processing..."
            : isRecording
              ? "Stop Recording"
              : "Start Recording"}
        </Button>

        {totalLatency > 0 && (
          <Tooltip content="Save performance logs for debugging">
            <Button
              color="secondary"
              variant="flat"
              onPress={savePerformanceLogs}
            >
              Save Logs
            </Button>
          </Tooltip>
        )}
      </div>

      {error && (
        <Card className="bg-danger-50">
          <CardBody>
            <p className="text-danger">{error}</p>
          </CardBody>
        </Card>
      )}

      {totalLatency > 0 && (
        <Card className="bg-warning-50">
          <CardBody>
            <h3 className="text-lg font-bold">Total End-to-End Latency:</h3>
            <p className="text-xl">{formatTime(totalLatency)}</p>
          </CardBody>
        </Card>
      )}

      {(partialText || recognizedText) && (
        <Card>
          <CardBody>
            <h3 className="text-lg font-bold mb-2">Transcription:</h3>
            {recognizedText && <p className="mb-2">{recognizedText}</p>}
            {partialText && (
              <div className="mt-2">
                <Chip color="primary" variant="flat" className="mr-2">
                  Partial
                </Chip>
                <span className="text-gray-500 italic">{partialText}</span>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {response && (
        <Card>
          <CardBody>
            <h3 className="text-lg font-bold mb-2">AI Response:</h3>
            <p>{response}</p>
          </CardBody>
        </Card>
      )}

      {metrics.length > 0 && (
        <Card>
          <CardBody>
            <h3 className="text-lg font-bold mb-2">
              Client-Side Performance Metrics:
            </h3>
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr>
                    <th className="px-4 py-2 text-left">Step</th>
                    <th className="px-4 py-2 text-left">Duration</th>
                    <th className="px-4 py-2 text-left">% of Total</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.map((metric, index) => (
                    <tr key={index} className="border-t">
                      <td className="px-4 py-2">{metric.step}</td>
                      <td className="px-4 py-2">
                        {formatTime(metric.duration)}
                      </td>
                      <td className="px-4 py-2">
                        {totalLatency > 0
                          ? `${((metric.duration / totalLatency) * 100).toFixed(1)}%`
                          : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Display API metrics */}
      {transcribeMetrics &&
        renderApiMetricsTable("Transcription API Metrics", transcribeMetrics)}
      {chatMetrics && renderApiMetricsTable("Chat API Metrics", chatMetrics)}

      {/* Audio level visualization (only when VAD is active) */}
      {usingVAD && isRecording && (
        <div className="mt-4 w-full bg-gray-200 rounded-full h-4">
          <div
            className="bg-green-600 h-4 rounded-full transition-all duration-100"
            style={{ width: `${Math.min(audioLevel * 100, 100)}%` }}
          />
        </div>
      )}

      <div className="flex items-center ml-4">
        <label className="inline-flex items-center">
          <input
            type="checkbox"
            className="form-checkbox h-5 w-5 text-blue-600"
            checked={usingVAD}
            onChange={toggleVADMode}
          />
          <span className="ml-2">Use Voice Detection (VAD)</span>
        </label>
      </div>
    </div>
  );
}
