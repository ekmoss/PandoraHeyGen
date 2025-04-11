"use client";

import React, { useState, useRef, useEffect } from "react";
import { Button, Card, CardBody } from "@nextui-org/react";

interface VoiceTestProps {
  onTranscriptionComplete?: (text: string) => void;
}

export default function VoiceTest({ onTranscriptionComplete }: VoiceTestProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recognizedText, setRecognizedText] = useState("");
  const [response, setResponse] = useState("");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && isRecording) {
        mediaRecorderRef.current.stop();
      }
    };
  }, [isRecording]);

  const getAudioStream = async () => {
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
      return stream;
    } catch (error) {
      console.error("Error accessing microphone:", error);
      throw new Error(
        "Failed to access microphone. Please ensure microphone permissions are granted."
      );
    }
  };

  const processTranscribedText = async (text: string) => {
    try {
      setIsProcessing(true);
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: text }),
      });

      if (!response.ok) {
        throw new Error(`Chat API error: ${response.statusText}`);
      }

      const data = await response.json();
      setResponse(data.message || "No response received");
    } catch (error) {
      console.error("Error processing chat:", error);
      setError(
        `Failed to get AI response: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const processAudioChunk = async (audioBlob: Blob) => {
    try {
      const formData = new FormData();
      formData.append("file", audioBlob, "audio.webm");

      const response = await fetch("/api/transcribe", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Transcription failed: ${response.statusText}`);
      }

      const result = await response.json();
      console.log("Transcription result:", result);

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
    }
  };

  const startRecording = async () => {
    try {
      setError(null);
      setIsProcessing(true);
      setResponse(""); // Clear previous response

      const stream = await getAudioStream();

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: "audio/webm;codecs=opus",
        audioBitsPerSecond: 16000,
      });

      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        try {
          setIsProcessing(true);
          // Combine all chunks into a single blob
          const audioBlob = new Blob(audioChunksRef.current, {
            type: "audio/webm;codecs=opus",
          });
          await processAudioChunk(audioBlob);
        } finally {
          setIsProcessing(false);
          stream.getTracks().forEach((track) => track.stop());
        }
      };

      // Record in larger chunks since we're processing at the end
      mediaRecorder.start(1000);
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
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
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
    </div>
  );
}
