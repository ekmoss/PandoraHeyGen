"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { Button, Card, CardBody, Chip, Tooltip } from "@nextui-org/react";
import { useAudioService } from "@/hooks/useAudioService";
import {
  processUserMessage,
  parseJsonResponse,
} from "../../services/openai-service";

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

  const audioChunksRef = useRef<Blob[]>([]);
  const recordingStartTimeRef = useRef<number>(0);

  // Add WebWorker management
  const audioWorkerRef = useRef<Worker | null>(null);

  // Initialize AudioService via hook
  const {
    isRecording,
    startRecording,
    stopRecording,
    isProcessing,
    setIsProcessing,
    currentSession,
    audioChunks,
    shouldProcessWithAI,
    batchChunks,
    prepareChunkFormData,
    error: audioServiceError,
  } = useAudioService({
    config: {
      vadEnabled: true,
      chunkDuration: 250,
      minChunkSize: 800,
    },
    onDataAvailable: (blob) => {
      audioChunksRef.current.push(blob);
    },
    onSpeechStart: () => {
      const vadStartTime =
        vadMetrics.vadToRecordingStartTime || performance.now();
      setVadMetrics((prev) => ({
        ...prev,
        vadToRecordingStartTime: vadStartTime,
      }));
      setAudioLevel(0.5); // Initial level when speech starts
    },
    onSpeechEnd: (data) => {
      if (data.isSpeechDetected) {
        const speechEndTime = performance.now();
        setVadMetrics((prev) => ({
          ...prev,
          vadToRecordingStopTime: speechEndTime,
          totalSpeechDuration: data.duration,
        }));

        // Optionally auto-stop recording after significant speech
        if (isRecording && data.duration > 1500) {
          handleToggleRecording();
        }
      }
      setAudioLevel(0.05); // Low level when speech ends
    },
    onAudioLevel: (level) => {
      setAudioLevel(level);
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  const [usingVAD, setUsingVAD] = useState(true);
  const [audioLevel, setAudioLevel] = useState(0);

  useEffect(() => {
    if (audioServiceError && typeof audioServiceError.message === "string") {
      setError(audioServiceError.message);
    }
  }, [audioServiceError]);

  // Helper function to log performance metrics
  const logPerformance = useCallback(
    (step: string, startTime: number, endTime: number) => {
      const duration = endTime - startTime;
      setMetrics((prev) => [...prev, { step, startTime, endTime, duration }]);
      return duration;
    },
    []
  );

  // Process the final transcription through the chat API
  const processChatResponse = useCallback(
    async (transcription: string) => {
      if (!transcription) {
        console.error("Empty transcription, skipping chat processing");
        return;
      }

      const chatStartTime = performance.now();
      setIsProcessing(true);

      try {
        // Log service preparation time
        const serviceStartTime = performance.now();
        logPerformance("Service Preparation", chatStartTime, serviceStartTime);

        // Call the chat API using the new service
        console.log("Calling chat API with transcription:", transcription);
        const chatResponse = await processUserMessage(transcription, {
          stream: false,
        });

        // Log API call duration
        const apiResponseTime = performance.now();
        logPerformance("OpenAI API Call", serviceStartTime, apiResponseTime);

        if (!chatResponse.ok) {
          throw new Error(`Chat API error: ${chatResponse.status}`);
        }

        // Log response parsing time
        const parseStartTime = performance.now();
        const data = await parseJsonResponse(chatResponse);
        const parseEndTime = performance.now();
        logPerformance("Parse Response", parseStartTime, parseEndTime);

        // Log metrics if available
        if (data.metrics) {
          console.log("Chat API metrics:", data.metrics);
          setChatMetrics(data.metrics);

          // Add the server-side metrics to our client-side metrics
          // for a complete picture of the request lifecycle
          if (data.metrics.openAIApiCall) {
            logPerformance(
              "Server: OpenAI API Call",
              0, // Relative time, not absolute
              data.metrics.openAIApiCall
            );
          }

          if (data.metrics.parseRequest) {
            logPerformance(
              "Server: Parse Request",
              0,
              data.metrics.parseRequest
            );
          }

          if (data.metrics.parseResponse) {
            logPerformance(
              "Server: Parse Response",
              0,
              data.metrics.parseResponse
            );
          }
        }

        const chatEndTime = performance.now();
        logPerformance("Total API Roundtrip", chatStartTime, chatEndTime);

        // Extract the message from the response
        setResponse(data.message || "No response received");

        // Log the full end-to-end processing time
        const totalProcessingTime = performance.now() - chatStartTime;
        logPerformance(
          "End-to-End Processing",
          chatStartTime,
          performance.now()
        );

        // Update our total latency measure
        if (recordingStartTimeRef.current > 0) {
          const totalLatency =
            performance.now() - recordingStartTimeRef.current;
          setTotalLatency(totalLatency);
        }
      } catch (error: any) {
        console.error("Error processing chat:", error);
        setError(
          `Error processing chat: ${error instanceof Error ? error.message : String(error)}`
        );
        setResponse("Error: Unable to get AI response");
      } finally {
        setIsProcessing(false);
      }
    },
    [logPerformance, setIsProcessing]
  );

  // Process the recorded audio
  const processRecordedAudio = useCallback(
    async (audioBlob: Blob) => {
      const processStartTime = performance.now();
      setIsProcessing(true);
      setError(null);

      try {
        // Log the initial timing
        logPerformance(
          "Start Processing Audio",
          processStartTime,
          performance.now()
        );

        // Prepare form data with the audio blob
        const formData = await prepareChunkFormData(audioBlob, true);

        // Log form data preparation
        const formDataTime = performance.now();
        logPerformance("Prepare Form Data", processStartTime, formDataTime);

        // Send to transcription API
        console.log("Sending audio to transcription API");
        const transcriptionResponse = await fetch("/api/transcribe", {
          method: "POST",
          body: formData,
        });

        if (!transcriptionResponse.ok) {
          throw new Error(
            `Transcription API error: ${transcriptionResponse.status}`
          );
        }

        const apiResponseTime = performance.now();
        logPerformance("Transcription API Call", formDataTime, apiResponseTime);

        // Parse the response
        const transcriptionResult = await transcriptionResponse.json();

        // Log parse time
        const parseTime = performance.now();
        logPerformance(
          "Parse Transcription Result",
          apiResponseTime,
          parseTime
        );

        // Store API metrics if available
        if (transcriptionResult.metrics) {
          setTranscribeMetrics(transcriptionResult.metrics);
        }

        // Extract the text
        const transcribedText = transcriptionResult.text || "";

        // Update state with the transcribed text
        setRecognizedText(transcribedText);
        setPartialText("");

        if (onTranscriptionComplete) {
          onTranscriptionComplete(transcribedText);
        }

        // Process with AI if this is a complete thought
        if (shouldProcessWithAI(transcribedText)) {
          await processChatResponse(transcribedText);
        }

        // Calculate total latency
        const totalProcessingTime = performance.now() - processStartTime;
        setTotalLatency(totalProcessingTime);

        return {
          transcribedText,
          totalProcessingTime,
        };
      } catch (error: any) {
        console.error("Error processing audio:", error);
        setError(
          `Error processing audio: ${error instanceof Error ? error.message : String(error)}`
        );
        return null;
      } finally {
        setIsProcessing(false);
      }
    },
    [
      logPerformance,
      shouldProcessWithAI,
      processChatResponse,
      onTranscriptionComplete,
      setIsProcessing,
      currentSession,
    ]
  );

  // Handle the toggle recording action
  const handleToggleRecording = useCallback(async () => {
    if (!isRecording) {
      const startButtonTime = performance.now();
      setMetrics([]);
      setError(null);
      setRecognizedText("");
      setPartialText("");
      setResponse("");
      setTranscribeMetrics(null);
      setChatMetrics(null);
      audioChunksRef.current = [];

      // Start timing for overall latency
      recordingStartTimeRef.current = performance.now();

      try {
        await startRecording();
        logPerformance("Start Recording", startButtonTime, performance.now());
      } catch (error: any) {
        console.error("Error starting recording:", error);
        setError(
          `Error starting recording: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    } else {
      const stopButtonTime = performance.now();

      try {
        // Stop recording and get the audio
        const audioBlob = await stopRecording();
        logPerformance("Stop Recording", stopButtonTime, performance.now());

        // Calculate recording duration
        const recordingDuration =
          performance.now() - recordingStartTimeRef.current;
        logPerformance(
          "Total Recording Time",
          recordingStartTimeRef.current,
          performance.now()
        );

        console.log(
          `Recording stopped, blob size: ${audioBlob.size} bytes, duration: ${recordingDuration}ms`
        );

        // Process the audio
        await processRecordedAudio(audioBlob);
      } catch (error: any) {
        console.error("Error stopping recording:", error);
        setError(
          `Error stopping recording: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }, [
    isRecording,
    startRecording,
    stopRecording,
    processRecordedAudio,
    logPerformance,
  ]);

  // Format time for display
  const formatTime = (ms: number | string | null | undefined) => {
    if (ms === null || ms === undefined) return "N/A";
    const milliseconds = typeof ms === "string" ? parseFloat(ms) : ms;
    return milliseconds.toFixed(2) + "ms";
  };

  // Warm up the APIs
  const warmUpAPIs = useCallback(async () => {
    setIsProcessing(true);
    try {
      // Warm up the check-azure endpoint
      const response = await fetch("/api/check-azure");
      const result = await response.json();
      console.log("API warm-up result:", result);
    } catch (error) {
      console.error("Error during API warm-up:", error);
    } finally {
      setIsProcessing(false);
    }
  }, []);

  // Toggle VAD mode
  const toggleVADMode = useCallback(() => {
    setUsingVAD((prev) => !prev);
  }, []);

  // Render API metrics in a table with enhanced information
  const renderApiMetricsTable = (title: string, metrics: ApiMetrics | null) => {
    if (!metrics) return null;

    // Calculate total time excluding parent metrics
    const totalTime =
      metrics.total ||
      Object.values(metrics).reduce((sum, value) => sum + value, 0);

    return (
      <div>
        <h3 className="text-sm font-semibold mt-2">{title}</h3>
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr>
                <th className="px-1 py-1 text-left">Metric</th>
                <th className="px-1 py-1 text-right">Time</th>
                <th className="px-1 py-1 text-right">%</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(metrics)
                // Sort by time (descending)
                .sort(([, a], [, b]) => (b as number) - (a as number))
                .map(([key, value]) => (
                  <tr key={key} className="border-t border-gray-200">
                    <td className="px-1 py-1 text-left">{key}</td>
                    <td className="px-1 py-1 text-right">
                      {typeof value === "number"
                        ? formatTime(value)
                        : String(value)}
                    </td>
                    <td className="px-1 py-1 text-right">
                      {typeof value === "number" && totalTime > 0
                        ? `${((value / totalTime) * 100).toFixed(1)}%`
                        : "-"}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="p-4">
      <h1 className="text-xl font-bold mb-4">Streaming Voice Test</h1>

      <div className="mb-4 space-x-2">
        <Button
          color={isRecording ? "danger" : "primary"}
          onClick={handleToggleRecording}
          disabled={isProcessing}
        >
          {isRecording ? "Stop Recording" : "Start Recording"}
        </Button>

        <Button
          color="secondary"
          onClick={toggleVADMode}
          disabled={isRecording || isProcessing}
        >
          VAD: {usingVAD ? "ON" : "OFF"}
        </Button>

        <Button
          color="default"
          onClick={warmUpAPIs}
          disabled={isRecording || isProcessing}
        >
          Warm-up APIs
        </Button>
      </div>

      {/* Audio level visualizer */}
      <div className="mb-4">
        <div className="h-2 bg-gray-200 rounded-full overflow-hidden mb-1">
          <div
            className="h-full bg-blue-600 transition-all duration-100 ease-in-out"
            style={{ width: `${Math.min(audioLevel * 100, 100)}%` }}
          />
        </div>
        <p className="text-xs text-gray-500">Audio Level</p>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-100 border border-red-300 rounded text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="col-span-1">
          <CardBody>
            <div className="mb-2">
              <h2 className="text-lg font-semibold">Transcription</h2>
              {isProcessing && (
                <Chip size="sm" color="warning">
                  Processing...
                </Chip>
              )}
              {isRecording && (
                <Chip size="sm" color="danger">
                  Recording
                </Chip>
              )}
            </div>

            {partialText && (
              <div className="mb-4 p-3 bg-gray-50 rounded italic text-gray-600">
                {partialText}
              </div>
            )}

            <div className="p-3 bg-white border border-gray-200 rounded min-h-[100px]">
              {recognizedText || "Speak to see transcription..."}
            </div>
          </CardBody>
        </Card>

        <Card className="col-span-1">
          <CardBody>
            <h2 className="text-lg font-semibold mb-2">AI Response</h2>
            <div className="p-3 bg-white border border-gray-200 rounded min-h-[100px]">
              {response || "Your AI response will appear here..."}
            </div>
          </CardBody>
        </Card>
      </div>

      <Card className="mt-4">
        <CardBody>
          <h2 className="text-lg font-semibold mb-2">Performance Metrics</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="col-span-1">
              <h3 className="text-sm font-semibold">Operations</h3>
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr>
                      <th className="px-1 py-1 text-left">Step</th>
                      <th className="px-1 py-1 text-right">Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.map((metric, index) => (
                      <tr key={index} className="border-t border-gray-200">
                        <td className="px-1 py-1 text-left">{metric.step}</td>
                        <td className="px-1 py-1 text-right">
                          {formatTime(metric.duration)}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t border-gray-200 font-semibold">
                      <td className="px-1 py-1 text-left">Total Latency</td>
                      <td className="px-1 py-1 text-right">
                        {formatTime(totalLatency)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className="col-span-1">
              <div className="mb-4">
                <h3 className="text-sm font-semibold">
                  Voice Activity Detection
                </h3>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-xs">
                    <tbody>
                      <tr className="border-t border-gray-200">
                        <td className="px-1 py-1 text-left">Speech Duration</td>
                        <td className="px-1 py-1 text-right">
                          {formatTime(vadMetrics.totalSpeechDuration)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {renderApiMetricsTable(
                "Transcription API Metrics",
                transcribeMetrics
              )}
              {renderApiMetricsTable("Chat API Metrics", chatMetrics)}
            </div>
          </div>
        </CardBody>
      </Card>

      {currentSession && (
        <div className="mt-4 text-xs text-gray-500">
          <p>Session ID: {currentSession.sessionId}</p>
        </div>
      )}
    </div>
  );
}
