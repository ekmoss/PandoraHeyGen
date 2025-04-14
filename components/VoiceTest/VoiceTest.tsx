"use client";

import React, { useState, useRef, useEffect } from "react";
import { Button, Card, CardBody } from "@nextui-org/react";

interface VoiceTestProps {
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

export default function VoiceTest({ onTranscriptionComplete }: VoiceTestProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recognizedText, setRecognizedText] = useState("");
  const [response, setResponse] = useState("");

  // Add performance metrics state
  const [metrics, setMetrics] = useState<PerformanceMetric[]>([]);
  const [totalLatency, setTotalLatency] = useState<number>(0);

  // Add API metrics state
  const [transcribeMetrics, setTranscribeMetrics] = useState<ApiMetrics | null>(
    null
  );
  const [chatMetrics, setChatMetrics] = useState<ApiMetrics | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingStartTimeRef = useRef<number>(0);

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && isRecording) {
        mediaRecorderRef.current.stop();
      }
    };
  }, [isRecording]);

  // Helper function to log performance metrics
  const logPerformance = (step: string, startTime: number, endTime: number) => {
    const duration = endTime - startTime;
    setMetrics((prev) => [...prev, { step, startTime, endTime, duration }]);
    return duration;
  };

  const getAudioStream = async () => {
    const startTime = performance.now();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          sampleSize: 16,
          echoCancellation: true,
          noiseSuppression: true,
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
  };

  const processTranscribedText = async (text: string) => {
    const startTime = performance.now();
    try {
      setIsProcessing(true);

      const chatStartTime = performance.now();
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: text }),
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
  };

  const processAudioChunk = async (audioBlob: Blob) => {
    const startTime = performance.now();
    try {
      const formData = new FormData();
      formData.append("file", audioBlob, "audio.webm");

      const transcribeStartTime = performance.now();
      const response = await fetch("/api/transcribe", {
        method: "POST",
        body: formData,
      });
      const transcribeEndTime = performance.now();
      const transcribeDuration = logPerformance(
        "Transcribe API Call",
        transcribeStartTime,
        transcribeEndTime
      );
      console.log(`Transcription took ${transcribeDuration.toFixed(2)}ms`);

      if (!response.ok) {
        throw new Error(`Transcription failed: ${response.statusText}`);
      }

      const parseStartTime = performance.now();
      const result = await response.json();
      const parseEndTime = performance.now();
      logPerformance(
        "Parse Transcription Result",
        parseStartTime,
        parseEndTime
      );

      console.log("Transcription result:", result);

      // Store API metrics if available
      if (result.metrics) {
        setTranscribeMetrics(result.metrics);
        console.log("Transcribe API metrics:", result.metrics);
      }

      if (result.text) {
        const text = result.text.trim();
        setRecognizedText((prev) => prev + " " + text);
        if (onTranscriptionComplete) {
          onTranscriptionComplete(text);
        }
        // Process the transcribed text with Azure OpenAI
        await processTranscribedText(text);
      }
    } catch (error) {
      console.error("Error processing audio chunk:", error);
      setError(
        `Failed to process audio: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      const endTime = performance.now();
      const totalDuration = logPerformance(
        "Total Audio Processing",
        startTime,
        endTime
      );

      // Calculate total latency from recording start to response
      if (recordingStartTimeRef.current > 0) {
        const totalLatency = endTime - recordingStartTimeRef.current;
        setTotalLatency(totalLatency);
        logPerformance(
          "End-to-End Latency",
          recordingStartTimeRef.current,
          endTime
        );
        console.log(`Total latency: ${totalLatency.toFixed(2)}ms`);
      }
    }
  };

  const startRecording = async () => {
    try {
      setError(null);
      setIsProcessing(true);
      setResponse(""); // Clear previous response
      setMetrics([]); // Clear previous metrics
      setTranscribeMetrics(null); // Clear previous API metrics
      setChatMetrics(null); // Clear previous API metrics

      const recordingStartTime = performance.now();
      recordingStartTimeRef.current = recordingStartTime;

      const stream = await getAudioStream();

      const initStartTime = performance.now();
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: "audio/webm;codecs=opus",
        audioBitsPerSecond: 16000,
      });
      const initEndTime = performance.now();
      logPerformance("Initialize MediaRecorder", initStartTime, initEndTime);

      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          const chunkTime = performance.now();
          audioChunksRef.current.push(event.data);
          console.log(
            `Audio chunk received at ${chunkTime.toFixed(2)}ms, size: ${event.data.size} bytes`
          );
        }
      };

      mediaRecorder.onstop = async () => {
        try {
          const stopTime = performance.now();
          logPerformance("Recording Duration", recordingStartTime, stopTime);

          setIsProcessing(true);
          // Combine all chunks into a single blob
          const blobStartTime = performance.now();
          const audioBlob = new Blob(audioChunksRef.current, {
            type: "audio/webm;codecs=opus",
          });
          const blobEndTime = performance.now();
          logPerformance("Create Audio Blob", blobStartTime, blobEndTime);

          console.log(`Audio blob size: ${audioBlob.size} bytes`);
          await processAudioChunk(audioBlob);
        } finally {
          setIsProcessing(false);
          stream.getTracks().forEach((track) => track.stop());
        }
      };

      // Record in larger chunks since we're processing at the end
      mediaRecorder.start(1000);
      const startRecordingEndTime = performance.now();
      logPerformance(
        "Start Recording",
        recordingStartTime,
        startRecordingEndTime
      );

      setIsRecording(true);
      setIsProcessing(false);
    } catch (error) {
      console.error("Error starting recording:", error);
      setError(
        `Failed to start recording: ${error instanceof Error ? error.message : String(error)}`
      );
      setIsProcessing(false);
    }
  };

  const stopRecording = () => {
    const stopStartTime = performance.now();
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      const stopEndTime = performance.now();
      logPerformance("Stop Recording Command", stopStartTime, stopEndTime);
      setIsRecording(false);
    }
  };

  // Format time for display
  const formatTime = (ms: number) => {
    return `${ms.toFixed(2)}ms`;
  };

  // Render API metrics table
  const renderApiMetricsTable = (title: string, metrics: ApiMetrics | null) => {
    if (!metrics) return null;

    const total = metrics.total || 0;

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
                  .filter(([key]) => key !== "total")
                  .sort(([, a], [, b]) => b - a) // Sort by duration descending
                  .map(([key, value], index) => (
                    <tr key={index} className="border-t">
                      <td className="px-4 py-2">{key}</td>
                      <td className="px-4 py-2">{formatTime(value)}</td>
                      <td className="px-4 py-2">
                        {total > 0
                          ? `${((value / total) * 100).toFixed(1)}%`
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

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-2xl font-bold">Voice Processing Latency Test</h1>

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

      {recognizedText && (
        <Card>
          <CardBody>
            <h3 className="text-lg font-bold mb-2">Recognized Text:</h3>
            <p>{recognizedText}</p>
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
    </div>
  );
}
