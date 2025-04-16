"use client";

/* eslint-disable no-console */
/**
 * InteractiveAvatar Component with Optimized Audio Processing
 *
 * This component implements a streaming HeyGen avatar with an optimized audio capture
 * and processing pipeline for reduced latency:
 *
 * Audio Optimization Strategy:
 * 1. Uses Web Workers for audio processing when available to move work off the main thread
 * 2. Implements optimized MediaRecorder settings with audio/webm;codecs=opus format
 * 3. Pre-warms API connections to reduce connection establishment overhead
 * 4. Uses parallel processing for audio preparation and API requests
 * 5. Tracks detailed performance metrics for all operations
 * 6. Implements optimized audio blob handling with direct ArrayBuffer manipulation
 * 7. Uses dynamic timeouts based on audio chunk size and type
 *
 * The audio processing flow:
 * - User clicks "Push to Talk" → startPushToTalk → MediaRecorder starts
 * - Audio chunks collected in audioChunksRef
 * - User clicks "Stop" → stopPushToTalk → MediaRecorder stops
 * - processRecordedAudio processes the chunks (using Web Worker if available)
 * - Audio sent to transcription API
 * - Transcription sent to Chat API
 * - Avatar speaks the response
 *
 * All operations are carefully timed and logged to console for performance analysis.
 */
import type { StartAvatarResponse } from "@heygen/streaming-avatar";

import StreamingAvatar, {
  AvatarQuality,
  StreamingEvents,
  TaskMode,
  TaskType,
  VoiceEmotion,
} from "@heygen/streaming-avatar";
import {
  Button,
  Card,
  CardBody,
  CardFooter,
  Divider,
  Input,
  Select,
  SelectItem,
  Spinner,
  Chip,
  Tabs,
  Tab,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  useDisclosure,
} from "@nextui-org/react";
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useMemoizedFn, usePrevious } from "ahooks";

import InteractiveAvatarTextInput from "./InteractiveAvatarTextInput";

import { AVATARS, STT_LANGUAGE_LIST } from "@/app/lib/constants";
import { AppConfig } from "@/app/lib/configTypes";
import { useAudioService } from "@/hooks/useAudioService";
import Image from "next/image";

interface InteractiveAvatarProps {
  initialConfig: AppConfig;
}

export default function InteractiveAvatar({
  initialConfig,
}: InteractiveAvatarProps) {
  // Add mounting guard at the top
  const [isMounted, setIsMounted] = useState(false);

  // Use the provided configuration
  const config = initialConfig;

  // Move all state declarations here but initialize with safe values
  const [isLoadingSession, setIsLoadingSession] = useState(false);
  const [isLoadingRepeat, setIsLoadingRepeat] = useState(false);
  const [stream, setStream] = useState<MediaStream | undefined>(undefined);
  const [debug, setDebug] = useState<string>();

  // Initial state from config
  const [knowledgeId, setKnowledgeId] = useState<string>(
    config.avatar.defaultKnowledgeId
  );
  const [avatarId, setAvatarId] = useState<string>(
    config.avatar.defaultAvatarId
  );
  const [language, setLanguage] = useState<string>(
    config.avatar.defaultLanguage
  );

  const [removeBackground, setRemoveBackground] = useState<boolean>(
    config.avatar.removeBackground || false
  );
  const [chromaKeyColor, setChromaKeyColor] = useState<string>(
    config.avatar.chromaKeyColour || "#00FF00"
  );
  const [chromaKeyThreshold, setChromaKeyThreshold] = useState<number>(
    config.avatar.chromaKeyThreshold || 40
  );

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPushingToTalk, setIsPushingToTalk] = useState(false);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const { isOpen, onOpen, onOpenChange, onClose } = useDisclosure();
  const [error, setError] = useState<string | null>(null);

  const [data, setData] = useState<StartAvatarResponse>();
  const [text, setText] = useState<string>("");
  const mediaStream = useRef<HTMLVideoElement>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const avatar = useRef<StreamingAvatar | null>(null);
  const [chatMode, setChatMode] = useState(config.avatar.defaultChatMode);
  const [isUserTalking, setIsUserTalking] = useState(false);
  const [adminAccessCode, setAdminAccessCode] = useState("");
  const adminCode = config.admin.accessCode;

  // Use conversation starters from config
  const [currentStarterIndex, setCurrentStarterIndex] = useState(0);
  const conversationStarters = config.content.conversationStarters;

  // Add these simplified state variables
  const [lastToggleTime, setLastToggleTime] = useState(0);
  const [micError, setMicError] = useState<string | null>(null);

  // Add state to track image loading errors
  const [backgroundImgError, setBackgroundImgError] = useState(false);
  const [loadingImgError, setLoadingImgError] = useState(false);
  const [avatarBackground, setAvatarBackground] = useState<string>(
    config.ui.defaultBackgroundImage || "/bg-empty-lobby.jpg"
  );

  // Simply use the configured image paths directly
  const welcomeBackgroundUrl = config.ui.welcomeBackgroundImage;
  const loadingBackgroundUrl = config.ui.loadingBackgroundImage;

  // First, let's add some state to track WebRTC connections
  const [webrtcConnection, setWebrtcConnection] = useState<any>(null);

  // Add state to track speech detection and a reference to the original microphone
  const [isOriginalMicConnected, setIsOriginalMicConnected] = useState(false);
  const originalMicRef = useRef<MediaStreamTrack | null>(null);

  // Add a loading state
  const [isLoading, setIsLoading] = useState(false);

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
      // This function will be called whenever audio data is available
      console.log(`Audio chunk available: ${blob.size} bytes`);

      // If you need to maintain compatibility with existing code:
      if (!audioChunksRef.current) {
        audioChunksRef.current = [];
      }
      audioChunksRef.current.push(blob);
    },
    onSpeechStart: () => {
      console.log("Speech detected - user started talking");
      setIsUserTalking(true);
    },
    onSpeechEnd: (data) => {
      console.log("Speech ended", data);
      setIsUserTalking(false);

      // Optionally auto-stop recording after significant speech
      if (isRecording && data.duration > 1500) {
        handlePushToTalkClick();
      }
    },
    onAudioLevel: (level) => {
      // Could be used to visualize audio level if needed
    },
    onError: (err) => {
      console.error("Audio service error:", err);
      setMicError(err.message);
    },
  });

  // Track recording start time for latency measurement
  const recordingStartTimeRef = useRef<number>(0);

  // Access logo config
  const logoConfig = useMemo(
    () =>
      initialConfig?.ui?.logoStyle || {
        position: "top-4 left-4",
        size: "w-44 md:w-56 lg:w-64",
        maxHeight: "90px",
        filter: "drop-shadow(0px 1px 3px rgba(0,0,0,0.2))",
      },
    [initialConfig]
  );

  // Add a reference for the logo path
  const logoPath = useMemo(() => {
    // Check if logo is defined in the config
    const configLogoPath = initialConfig?.ui.logo || "/logo.png";
    return configLogoPath;
  }, [initialConfig]);

  // Keyboard shortcut listener for admin panel
  useEffect(() => {
    let keySequence = "";
    const keyTimeout = 2000; // 2 seconds timeout for key sequence
    let timer: NodeJS.Timeout;

    // Only set up effect after mounted
    if (!isMounted) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Add the key to the sequence
      keySequence += e.key.toLowerCase();

      // Check if the admin keyword has been typed
      if (keySequence.includes("admin")) {
        // Hardcoded as "admin" since config.admin.keyword doesn't exist
        onOpen(); // Open the admin access modal
        keySequence = ""; // Reset the sequence
      }

      // Reset the timer
      clearTimeout(timer);
      timer = setTimeout(() => {
        keySequence = "";
      }, keyTimeout);
    };

    window.addEventListener("keydown", handleKeyDown);

    // Clean up
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      clearTimeout(timer);
    };
  }, [isMounted, onOpen]);

  // Setup mounting state
  useEffect(() => {
    setIsMounted(true);
    return () => {
      setIsMounted(false);
    };
  }, []);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      console.log("Component unmounting, cleaning up...");
      if (avatar.current) {
        avatar.current.stopAvatar?.();
      }
    };
  }, []);

  // Effect to monitor audio service errors
  useEffect(() => {
    if (audioServiceError && typeof audioServiceError.message === "string") {
      setMicError(audioServiceError.message);
    }
  }, [audioServiceError]);

  // Rendering functions for canvas background removal
  const hexToRgb = (hex: string): number[] => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
      ? [
          parseInt(result[1], 16),
          parseInt(result[2], 16),
          parseInt(result[3], 16),
        ]
      : [0, 255, 0]; // default green if parsing fails
  };

  const renderCanvas = () => {
    if (!canvasRef.current || !mediaStream.current) return;

    const canvas = canvasRef.current;
    const video = mediaStream.current;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set canvas size to match video
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // Draw video to canvas
    ctx.drawImage(video, 0, 0);

    // If background removal is enabled, apply it
    if (removeBackground) {
      const targetColor = hexToRgb(chromaKeyColor);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        if (isCloseToTargetColor([r, g, b], targetColor, chromaKeyThreshold)) {
          data[i + 3] = 0; // Make pixel transparent
        }
      }

      ctx.putImageData(imageData, 0, 0);
    }

    // Request next frame
    requestAnimationFrame(renderCanvas);
  };

  const isCloseToTargetColor = (
    color: number[],
    target: number[],
    threshold: number
  ): boolean => {
    // Simple distance calculation
    const distance = Math.sqrt(
      Math.pow(color[0] - target[0], 2) +
        Math.pow(color[1] - target[1], 2) +
        Math.pow(color[2] - target[2], 2)
    );
    return distance < threshold;
  };

  // Function to fetch access token for the avatar
  async function fetchAccessToken() {
    try {
      const startTime = performance.now();
      // Change to the proper HeyGen token endpoint with POST method
      const response = await fetch("/api/get-access-token", {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch token: ${response.status}`);
      }
      // The endpoint returns the token as plain text
      const token = await response.text();
      console.log(
        `Token fetch took: ${(performance.now() - startTime).toFixed(2)}ms`
      );
      return { token };
    } catch (error) {
      console.error("Error fetching access token:", error);
      throw error;
    }
  }

  const endSession = useCallback(() => {
    try {
      // Use interrupt or stopAvatar instead of stop
      avatar.current?.stopAvatar?.();
      setStream(undefined);
      setData(undefined);
    } catch (e) {
      console.error("Error ending session:", e);
    }
  }, []);

  let cleanup = () => {};

  const initializeMicrophone = async () => {
    if (!avatar.current) return;

    try {
      // Try to connect original microphone (just for avatar lip sync detection, not for recording)
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });

      if (micStream && micStream.getAudioTracks().length > 0) {
        originalMicRef.current = micStream.getAudioTracks()[0];
        setIsOriginalMicConnected(true);
        console.log("Original microphone connected for avatar lip sync.");
      }
    } catch (error) {
      console.error(
        "Failed to get original microphone for lip sync (non-critical):",
        error
      );
      setIsOriginalMicConnected(false);
    }
  };

  // Add or modify the useRef for tracking if we've handled a user gesture
  const userInteractionRef = useRef(false);

  // Add a function to prepare audio context
  const prepareAudioContext = useCallback(() => {
    if (userInteractionRef.current) return;

    // This function should be called in response to a user gesture
    // It initializes AudioContext properly to comply with browser autoplay policies
    try {
      // Create and resume AudioContext
      const AudioContext =
        window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContext) {
        const audioCtx = new AudioContext();
        // Resume the audio context
        if (audioCtx.state === "suspended") {
          audioCtx.resume().then(() => {
            console.log("AudioContext successfully resumed");
          });
        }
        // Set flag to avoid repeated initialization
        userInteractionRef.current = true;
      }
    } catch (error) {
      console.error("Error initializing AudioContext:", error);
    }
  }, []);

  // Modify the startSession function to add the audio context initialization
  async function startSession() {
    // Initialize audio context early in the function to ensure it's ready
    prepareAudioContext();

    if (isLoadingSession) {
      console.log("Session load already in progress, ignoring duplicate call");
      return;
    }

    setIsLoadingSession(true);

    // Make sure to fully clean up any existing avatar instance
    if (avatar.current) {
      console.log("Cleaning up previous avatar instance");
      try {
        // Then stop the avatar
        avatar.current.stopAvatar?.();
        avatar.current = null;
      } catch (cleanupError) {
        console.error("Error during avatar cleanup:", cleanupError);
      }
    }

    // Set all state back to initial values
    setStream(undefined);
    setData(undefined);
    setError(null);

    try {
      // If we already have a token, use it (but refetch if needed)
      const tokenStartTime = performance.now();
      const tokenData = await fetchAccessToken();
      console.log(
        `Token fetch took: ${(performance.now() - tokenStartTime).toFixed(2)}ms`
      );

      // Pre-warm APIs to reduce latency for first interaction
      const warmUpStartTime = performance.now();
      try {
        await warmUpAPIs();
        console.log(
          `API warm-up took: ${(performance.now() - warmUpStartTime).toFixed(2)}ms`
        );
      } catch (warmUpError) {
        console.warn("API warm-up failed (non-critical):", warmUpError);
      }

      // Debug the avatar parameters
      console.log("Avatar parameters:", {
        avatarId,
        language,
        tokenLength: tokenData.token?.length || 0,
      });

      // Initialize the avatar
      const avatarStartTime = performance.now();
      avatar.current = new StreamingAvatar({
        token: tokenData.token || "", // Provide the token from fetchAccessToken
      });

      // Load the avatar using createStartAvatar instead of start
      // Make sure avatarId is valid
      const validAvatarId = avatarId || "June_HR_public"; // Default to a known working avatar if empty

      const data = await avatar.current.createStartAvatar({
        avatarName: validAvatarId,
        language: language || "en", // Make sure language isn't empty
        quality: AvatarQuality.High,
        voice: {
          emotion: VoiceEmotion.FRIENDLY,
        },
      });

      console.log(
        `Avatar initialization took: ${(performance.now() - avatarStartTime).toFixed(2)}ms`
      );

      // Register event listeners for StreamingAvatar
      if (avatar.current) {
        console.log("Setting up avatar event listeners");

        avatar.current.on(StreamingEvents.AVATAR_START_TALKING, () => {
          console.log("Avatar started talking");
        });

        avatar.current.on(StreamingEvents.AVATAR_STOP_TALKING, () => {
          console.log("Avatar stopped talking");
        });

        // Add stream ready event
        avatar.current.on(StreamingEvents.STREAM_READY, (e) => {
          console.log("Stream ready:", e);
        });

        // Better error handling for stream disconnection
        avatar.current.on(StreamingEvents.STREAM_DISCONNECTED, (e: any) => {
          console.error("Stream disconnected:", e);

          // Extract error message if available
          const errorMsg =
            e?.detail?.message ||
            (typeof e?.detail === "string" ? e.detail : "Connection lost") ||
            e?.message ||
            "WebRTC connection error";

          setError(`Avatar connection error: ${errorMsg}`);

          // Limit reconnection attempts - disable automatic reconnection
          // This prevents overwhelming the API with repeat requests
          console.log(
            "Auto-reconnect disabled - please try manually refreshing"
          );
        });
      }

      // Attach canvas setup for chromakey if enabled
      if (removeBackground) {
        // Start rendering to canvas for background removal
        requestAnimationFrame(renderCanvas);
      }

      setData(data);
      // Get the stream from the event or data depending on API version
      setStream(data.stream);

      await initializeMicrophone();

      // Track successful avatar setup for metrics
      const totalTime = performance.now() - tokenStartTime;
      console.log(`Total avatar setup time: ${totalTime.toFixed(2)}ms`);
    } catch (error) {
      console.error("Error starting avatar session:", error);
      setError(
        `Failed to start avatar: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    } finally {
      setIsLoadingSession(false);
    }
  }

  async function handleSpeak() {
    if (!avatar.current) return;
    try {
      await avatar.current.speak({ text });
    } catch (e) {
      console.error("Error in handleSpeak:", e);
    }
  }

  async function handleInterrupt() {
    if (!avatar.current) return;
    try {
      await avatar.current.interrupt();
    } catch (e) {
      console.error("Error in handleInterrupt:", e);
    }
  }

  // Handle transcription result and speak with avatar
  async function handleTranscriptionResult(
    transcribedText: string,
    aiResponse: string
  ) {
    try {
      console.log("Handling transcription result:", {
        transcription: transcribedText,
        aiResponse,
      });

      if (!transcribedText || !aiResponse) {
        console.log("Empty transcription or AI response, nothing to process");
        setIsProcessing(false);
        return;
      }

      // Now have the avatar speak the response
      const avatarStartTime = performance.now();

      if (avatar.current) {
        console.log(`Avatar speaking: "${aiResponse}"`);
        try {
          await avatar.current.speak({ text: aiResponse });
          console.log(
            `Avatar speak call took: ${(performance.now() - avatarStartTime).toFixed(2)}ms`
          );
        } catch (error) {
          console.error("Error having avatar speak:", error);
        }
      } else {
        console.warn("Avatar not available for speaking");
      }

      // Clear processing state
      setIsProcessing(false);
    } catch (error) {
      console.error("Error handling transcription result:", error);
      setIsProcessing(false);
    }
  }

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      // Enter fullscreen
      if (videoContainerRef.current?.requestFullscreen) {
        videoContainerRef.current.requestFullscreen().catch((err) => {
          console.error("Error attempting to enable fullscreen:", err);
        });
      }
    } else {
      // Exit fullscreen
      if (document.exitFullscreen) {
        document.exitFullscreen().catch((err) => {
          console.error("Error attempting to exit fullscreen:", err);
        });
      }
    }
  };

  // Initialize the avatar mic state when the mode changes
  useEffect(() => {
    const initializeAvatarMicState = async () => {
      if (!avatar.current || !stream) return;

      console.log(`Chat mode changed to: ${chatMode}`);

      try {
        if (chatMode === "voice_mode") {
          // In voice mode, we want the avatar's microphone off by default
          // so it doesn't listen to the user all the time
          avatar.current.stopListening();
          console.log("Avatar microphone disabled in voice mode");
        } else if (chatMode === "text_mode") {
          // In text mode, we want the avatar to listen to itself
          // (this may need to be adjusted depending on your needs)
          avatar.current.stopListening();
          console.log("Avatar microphone disabled in text mode");
        } else {
          avatar.current.stopListening();
          console.log("Avatar microphone disabled for unknown mode");
        }
      } catch (error) {
        console.error("Error initializing avatar mic state:", error);
      }
    };

    if (stream && isMounted) {
      initializeAvatarMicState();
    }
  }, [chatMode, stream, isMounted]);

  // Function to warm up APIs for faster first response
  const warmUpAPIs = async () => {
    try {
      const warmupStartTime = performance.now();

      // Warm up the transcribe API
      await fetch("/api/check-azure", {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });

      console.log(
        `API warm-up took: ${(performance.now() - warmupStartTime).toFixed(2)}ms`
      );
    } catch (error) {
      console.warn("API warm-up error (non-critical):", error);
    }
  };

  // Process recorded audio through transcription and chat APIs
  async function processRecordedAudio(): Promise<{
    transcribedText: string;
    aiResponse: string;
  } | null> {
    const chunks =
      audioChunks.length > 0 ? audioChunks : audioChunksRef.current;

    if (!chunks || chunks.length === 0) {
      console.log("No audio chunks to process");
      return null;
    }

    try {
      setIsProcessing(true);
      const startTime = performance.now();

      // Log audio chunks for debugging
      console.log("Audio chunks collected:", {
        count: chunks.length,
        totalSize: chunks.reduce(
          (sum: number, chunk: Blob) => sum + chunk.size,
          0
        ),
      });

      // Create combined blob from all chunks
      const combinedBlob = batchChunks(chunks);
      console.log(
        `Combined audio blob created: ${(combinedBlob.size / 1024).toFixed(2)}KB`
      );

      // Prepare the form data for the transcription request
      const formData = await prepareChunkFormData(combinedBlob, true);

      // Send the audio for transcription
      const transcribeStartTime = performance.now();
      const transcribeResponse = await fetch("/api/transcribe", {
        method: "POST",
        body: formData,
      });

      if (!transcribeResponse.ok) {
        throw new Error(`Transcription error: ${transcribeResponse.status}`);
      }

      const transcribeResult = await transcribeResponse.json();
      console.log(
        `Transcription API took: ${(performance.now() - transcribeStartTime).toFixed(2)}ms`
      );

      // Check if we have a valid transcription
      if (!transcribeResult.text || transcribeResult.text.trim() === "") {
        console.log("No transcription received");
        return null;
      }

      const transcribedText = transcribeResult.text.trim();
      console.log("Transcribed text:", transcribedText);

      // Get the AI response
      const aiResponse = await fetchChatResponse(transcribedText);
      console.log("AI response:", aiResponse);

      const totalTime = performance.now() - startTime;
      console.log(`Total processing time: ${totalTime.toFixed(2)}ms`);

      return { transcribedText, aiResponse };
    } catch (error) {
      console.error("Error processing audio:", error);
      setError(
        `Error processing audio: ${error instanceof Error ? error.message : String(error)}`
      );
      return null;
    } finally {
      setIsProcessing(false);
    }
  }

  // Fetch a response from the chat API
  async function fetchChatResponse(message: string): Promise<string> {
    const chatStartTime = performance.now();

    try {
      // Call the chat API
      console.log("Calling chat API with message:", message);
      const chatResponse = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [
            {
              role: "system",
              content: "You are a helpful assistant. Respond concisely.",
            },
            {
              role: "user",
              content: message,
            },
          ],
        }),
      });

      if (!chatResponse.ok) {
        throw new Error(`Chat API error: ${chatResponse.status}`);
      }

      const data = await chatResponse.json();
      console.log("Chat API response:", data);

      // Extract the message from the response
      const responseMessage =
        data.message ||
        (data.choices && data.choices[0]?.message?.content) ||
        "I'm sorry, I couldn't understand that.";

      const totalTime = performance.now() - chatStartTime;
      console.log(`Chat API total time: ${totalTime.toFixed(2)}ms`);

      return responseMessage;
    } catch (error) {
      console.error("Error getting chat response:", error);
      return "I'm sorry, I encountered an error processing your request.";
    }
  }

  // Modify the handlePushToTalkClick function to also ensure AudioContext is ready
  const handlePushToTalkClick = async () => {
    // Initialize AudioContext on user interaction
    prepareAudioContext();

    // Record performance metrics
    const clickTime = performance.now();
    console.log(`Push-to-talk button clicked at ${new Date().toISOString()}`);

    if (!isPushingToTalk) {
      // Start recording
      const startButtonTime = performance.now();
      setMicError(null); // Clear any previous errors
      setIsPushingToTalk(true);

      try {
        // Record the start time for latency calculation
        recordingStartTimeRef.current = performance.now();

        // Use the useAudioService hook to start recording
        await startRecording();

        console.log(
          `Start recording took: ${(performance.now() - startButtonTime).toFixed(2)}ms`
        );
      } catch (error) {
        console.error("Error starting recording:", error);
        setMicError("Failed to access microphone");
        setIsPushingToTalk(false);
      }
    } else {
      // Stop recording
      const stopButtonTime = performance.now();
      setIsPushingToTalk(false);

      try {
        // Stop recording and get the audio blob
        const audioBlob = await stopRecording();

        console.log(
          `Stop recording took: ${(performance.now() - stopButtonTime).toFixed(2)}ms`
        );

        // Process the recorded audio
        const result = await processRecordedAudio();

        // Handle the transcription result
        if (result) {
          await handleTranscriptionResult(
            result.transcribedText,
            result.aiResponse
          );
        }
      } catch (error) {
        console.error("Error stopping recording:", error);
        setMicError("Error processing your voice");
      }
    }

    console.log(
      `Total button interaction took: ${(performance.now() - clickTime).toFixed(2)}ms`
    );
  };

  const handleAdminAccess = () => {
    if (adminAccessCode === adminCode) {
      setShowAdminPanel(true);
      onClose();
    } else {
      setAdminAccessCode("");
    }
  };

  const previousText = usePrevious(text);

  useEffect(() => {
    if (!previousText && text) {
      avatar.current?.startListening();
    } else if (previousText && !text) {
      avatar?.current?.stopListening();
    }
  }, [text, previousText]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      endSession();
    };
  }, [endSession]);

  useEffect(() => {
    if (stream && chatMode === "voice_mode") {
      // Ensure microphone is disabled by default when session starts
      if (avatar.current) {
        avatar.current.stopListening();
      }
    }
  }, [stream, chatMode]);

  // Add this new useEffect to handle audio session properly
  useEffect(() => {
    // This effect ensures we properly set up the audio when the stream is ready
    if (stream && avatar.current && chatMode === "voice_mode") {
      // Initial state is mic off
      try {
        avatar.current.stopListening();
        console.log("Initial microphone state: disabled");
      } catch (error) {
        console.error("Error setting initial microphone state:", error);
      }
    }

    // Clean up on mode change or unmount
    return () => {
      if (avatar.current) {
        try {
          avatar.current.stopListening();
          console.log("Cleaning up microphone state");
        } catch (error) {
          console.error("Error cleaning up microphone:", error);
        }
      }
    };
  }, [stream, chatMode]);

  // Add this after recordingStartTimeRef
  const audioChunksRef = useRef<Blob[]>([]);

  // Replace the individual useEffect hooks with a more organized approach
  // Add this useEffect for session initialization to prevent duplicate calls
  useEffect(() => {
    // Only initialize if mounted, not already loading, no stream, AND no error
    if (isMounted && !isLoadingSession && !stream && !error) {
      console.log("Auto-initializing avatar session");
      startSession();
    }

    // On unmount, clean up resources
    return () => {
      if (avatar.current) {
        console.log("Component unmounting, cleaning up avatar resources");
        try {
          avatar.current.stopAvatar?.();
          avatar.current = null;
        } catch (e) {
          console.error("Error cleaning up avatar on unmount:", e);
        }
      }
    };
  }, [isMounted, isLoadingSession, stream, error]);

  // Don't render anything until mounted
  if (!isMounted) {
    return null;
  }

  return (
    <div className="w-full h-full flex flex-col">
      {/* Admin authentication modal */}
      <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">
            {config.admin.modalTitle}
          </ModalHeader>
          <ModalBody>
            <Input
              label="Access Code"
              placeholder="Enter admin access code"
              type="password"
              value={adminAccessCode}
              onChange={(e) => setAdminAccessCode(e.target.value)}
            />
          </ModalBody>
          <ModalFooter>
            <Button color="danger" variant="light" onPress={onClose}>
              Cancel
            </Button>
            <Button color="primary" onPress={handleAdminAccess}>
              Access Admin Panel
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Card className="w-full h-full flex flex-col">
        <CardBody className="flex-grow flex flex-col justify-center items-center p-0">
          {stream ? (
            <div className="h-full w-full relative overflow-hidden">
              {/* Video container with background */}
              <div ref={videoContainerRef} className="w-full h-full relative">
                {/* Background div - will show through transparent areas */}
                <div className="absolute inset-0 z-0 overflow-hidden">
                  <Image
                    src={avatarBackground}
                    alt="Background"
                    fill
                    style={{ objectFit: "cover" }}
                    priority
                    onLoad={() =>
                      console.log("Background image loaded successfully")
                    }
                    onError={(e) => {
                      console.error(
                        "Background image failed to load, using fallback"
                      );
                      setAvatarBackground("/bg-empty-lobby.jpg");
                      setAvatarBackground("/images/bg-lobby-empty.jpg");
                    }}
                  />
                </div>

                {/* Avatar video element - hidden when background removal is active */}
                <video
                  ref={mediaStream}
                  autoPlay
                  playsInline
                  className={`w-full h-full object-cover z-10 relative ${removeBackground ? "hidden" : ""}`}
                >
                  <track kind="captions" />
                </video>

                {/* Canvas for background removal - only shown when background removal is active */}
                <canvas
                  ref={canvasRef}
                  className={`w-full h-full object-cover z-10 relative ${!removeBackground ? "hidden" : ""}`}
                  style={{ backgroundColor: "transparent" }} // Ensure canvas background is transparent
                />

                {/* Remove the previous logo overlay */}
                {/* And replace the Maya text with logo */}
                <div className={`absolute ${logoConfig.position} z-20`}>
                  <div className="flex items-center gap-2">
                    <img
                      src={logoPath}
                      alt="Capgemini"
                      className={
                        initialConfig?.ui?.logoClass ||
                        "w-44 md:w-56 lg:w-64 object-contain"
                      }
                      style={{
                        filter: logoConfig.filter,
                        maxHeight: logoConfig.maxHeight,
                      }}
                    />
                  </div>
                </div>

                {/* Control buttons in top-right corner */}
                <div className=" hidden absolute top-4 right-4 gap-2 z-10">
                  {/* Fullscreen toggle button */}
                  <Button
                    isIconOnly
                    className="bg-capgemini-blue-500/80 backdrop-blur-sm text-white rounded-full w-12 h-12 flex items-center justify-center hover:bg-capgemini-blue-600/80 transition-colors"
                    onPress={toggleFullscreen}
                  >
                    {isFullscreen ? (
                      <svg
                        fill="currentColor"
                        height="24"
                        viewBox="0 0 16 16"
                        width="24"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path d="M5.5 0a.5.5 0 0 1 .5.5v4A1.5 1.5 0 0 1 4.5 6h-4a.5.5 0 0 1 0-1h4a.5.5 0 0 0 .5-.5v-4a.5.5 0 0 1 .5-.5zm5 0a.5.5 0 0 1 .5.5v4a.5.5 0 0 0 .5.5h4a.5.5 0 0 1 0 1h-4A1.5 1.5 0 0 1 10 4.5v-4a.5.5 0 0 1 .5-.5zM0 10.5a.5.5 0 0 1 .5-.5h4A1.5 1.5 0 0 1 6 11.5v4a.5.5 0 0 1-1 0v-4a.5.5 0 0 0-.5-.5h-4a.5.5 0 0 1-.5-.5zm10 1a1.5 1.5 0 0 1 1.5-1.5h4a.5.5 0 0 1 0 1h-4a.5.5 0 0 0-.5.5v4a.5.5 0 0 1-1 0v-4z" />
                      </svg>
                    ) : (
                      <svg
                        fill="currentColor"
                        height="24"
                        viewBox="0 0 16 16"
                        width="24"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path d="M1.5 1a.5.5 0 0 0-.5.5v4a.5.5 0 0 1-1 0v-4A1.5 1.5 0 0 1 1.5 0h4a.5.5 0 0 1 0 1h-4zM10 .5a.5.5 0 0 1 .5-.5h4A1.5 1.5 0 0 1 16 1.5v4a.5.5 0 0 1-1 0v-4a.5.5 0 0 0-.5-.5h-4a.5.5 0 0 1-.5-.5zM.5 10a.5.5 0 0 1 .5.5v4a.5.5 0 0 0 .5.5h4a.5.5 0 0 1 0 1h-4A1.5 1.5 0 0 1 0 14.5v-4a.5.5 0 0 1 .5-.5zm15 0a.5.5 0 0 1 .5.5v4a1.5 1.5 0 0 1-1.5 1.5h-4a.5.5 0 0 1 0-1h4a.5.5 0 0 0 .5-.5v-4a.5.5 0 0 1 .5-.5z" />
                      </svg>
                    )}
                  </Button>

                  {/* End session button - changed icon to "power off" symbol */}
                  <Button
                    isIconOnly
                    className="bg-red-500/80 backdrop-blur-sm text-white rounded-full w-12 h-12 flex items-center justify-center hover:bg-red-600/80 transition-colors"
                    onPress={endSession}
                  >
                    <svg
                      fill="currentColor"
                      height="24"
                      viewBox="0 0 16 16"
                      width="24"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path d="M7.5 1v7h1V1h-1z" />
                      <path d="M3 8.812a4.999 4.999 0 0 1 2.578-4.375l-.485-.874A6 6 0 1 0 11 3.616l-.501.865A5 5 0 1 1 3 8.812z" />
                    </svg>
                  </Button>
                </div>

                {/* Push-to-talk button at bottom center - enhanced visibility with gradient */}
                <div className="absolute bottom-8 left-3/4 transform -translate-x-1/2 z-10">
                  <Button
                    className={`relative z-20 mt-4 p-4 rounded-full ${
                      isPushingToTalk ? "bg-red-500" : "bg-blue-500"
                    } ${isLoading ? "loading" : ""}`}
                    size="lg"
                    onPress={handlePushToTalkClick}
                    disabled={isLoading}
                  >
                    <svg
                      fill="currentColor"
                      height="24"
                      viewBox="0 0 16 16"
                      width="24"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path d="M3.5 6.5A.5.5 0 0 1 4 7v1a4 4 0 0 0 8 0V7a.5.5 0 0 1 1 0v1a5 5 0 0 1-4.5 4.975V15h3a.5.5 0 0 1 0 1h-7a.5.5 0 0 1 0-1h3v-2.025A5 5 0 0 1 3 8V7a.5.5 0 0 1 .5-.5z" />
                      <path d="M10 8a2 2 0 1 1-4 0V3a2 2 0 1 1 4 0v5zM8 0a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V3a3 3 0 0 0-3-3z" />
                    </svg>
                    <span className="text-lg font-medium">
                      {isLoading
                        ? "•••"
                        : isPushingToTalk
                          ? "Stop Talking"
                          : micError
                            ? "Try Again"
                            : "Start Talking"}
                    </span>
                  </Button>
                </div>

                {/* Teams-style Out of Office message (replaces error alert) */}
                {error && (
                  <div
                    className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50 
                                  max-w-md w-full rounded-lg shadow-lg overflow-hidden bg-white border border-gray-100"
                  >
                    <div className="flex items-center bg-[#f0f2f5] p-4 border-b border-gray-200">
                      <div className="rounded-full bg-[#5b5fc7] p-2 mr-3">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="white"
                          width="18"
                          height="18"
                        >
                          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-6h2v2h-2zm0-8h2v6h-2z" />
                        </svg>
                      </div>
                      <span className="text-[#252423] font-semibold text-base">
                        Automatic Reply
                      </span>
                    </div>

                    <div className="p-5 bg-white">
                      <div className="flex mb-4">
                        <div className="w-10 h-10 rounded-full bg-[#f0f2f5] flex items-center justify-center mr-3 flex-shrink-0">
                          <span className="text-[#252423] font-semibold text-lg">
                            M
                          </span>
                        </div>
                        <div>
                          <p className="font-semibold text-[#252423]">Maya</p>
                          <p className="text-sm text-gray-500">
                            Digital Assistant
                          </p>
                        </div>
                      </div>

                      <div className="text-[#252423] mb-4">
                        I'm out of office at the moment. Please try again in a
                        few minutes.
                      </div>

                      <button
                        onClick={() => setError(null)}
                        className="transition-colors px-4 py-2 rounded bg-[#f0f2f5] hover:bg-[#e1e3e7] text-[#252423] font-medium text-sm"
                      >
                        Got it
                      </button>
                    </div>
                  </div>
                )}

                {/* Microphone error message - Teams style toast */}
                {micError && (
                  <div
                    className="absolute -bottom-12 left-1/2 transform -translate-x-1/2 
                                 bg-white border border-gray-200 rounded-md shadow-lg 
                                 p-3 flex items-center max-w-xs w-max animate-fade-in"
                  >
                    <div className="rounded-full bg-[#f0f2f5] p-1.5 mr-2 flex-shrink-0">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="#5b5fc7"
                        width="16"
                        height="16"
                      >
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-6h2v2h-2zm0-8h2v6h-2z" />
                      </svg>
                    </div>
                    <span className="text-[#252423] text-sm">{micError}</span>
                  </div>
                )}
              </div>
            </div>
          ) : !isLoadingSession ? (
            showAdminPanel ? (
              /* Admin Panel */
              <div className="h-full w-full justify-center items-center flex flex-col gap-8 p-8 bg-deep-purple-900 text-white">
                <div className="flex flex-col gap-4 w-full max-w-md">
                  <div className="text-2xl text-center font-bold text-white mb-4">
                    Admin Configuration Panel
                  </div>
                  <p className="text-sm font-medium leading-none">
                    Knowledge ID
                  </p>
                  <Input
                    classNames={{
                      input: "text-white",
                      inputWrapper: "bg-deep-purple-800 border-white",
                    }}
                    placeholder="Enter a knowledge ID"
                    value={knowledgeId}
                    onChange={(e) => setKnowledgeId(e.target.value)}
                  />
                  <p className="text-sm font-medium leading-none">Avatar ID</p>
                  <Input
                    classNames={{
                      input: "text-white",
                      inputWrapper: "bg-deep-purple-800 border-white",
                    }}
                    placeholder="Enter a custom avatar ID"
                    value={avatarId}
                    onChange={(e) => setAvatarId(e.target.value)}
                  />
                  <Select
                    classNames={{
                      trigger: "bg-deep-purple-800 text-white",
                    }}
                    placeholder="Or select one from these example avatars"
                    size="md"
                    onChange={(e) => {
                      setAvatarId(e.target.value);
                    }}
                  >
                    {AVATARS.map((avatar) => (
                      <SelectItem
                        key={avatar.avatar_id}
                        textValue={avatar.avatar_id}
                      >
                        {avatar.name}
                      </SelectItem>
                    ))}
                  </Select>
                  <Select
                    className="max-w-xs"
                    classNames={{
                      trigger: "bg-deep-purple-800 text-white",
                    }}
                    label="Select language"
                    placeholder="Select language"
                    selectedKeys={[language]}
                    onChange={(e) => {
                      setLanguage(e.target.value);
                    }}
                  >
                    {STT_LANGUAGE_LIST.map((lang) => (
                      <SelectItem key={lang.key}>{lang.label}</SelectItem>
                    ))}
                  </Select>
                </div>
                <div className="flex gap-2 w-full max-w-md">
                  <Button
                    className="bg-capgemini-blue text-white w-1/2"
                    size="lg"
                    variant="shadow"
                    onClick={() => setShowAdminPanel(false)}
                  >
                    Back to Welcome
                  </Button>
                  <Button
                    className="bg-gradient-to-tr from-green to-deep-purple-500 w-1/2 text-white"
                    size="lg"
                    variant="shadow"
                    onClick={startSession}
                  >
                    Start With Custom Settings
                  </Button>
                </div>
              </div>
            ) : (
              /* Attractive Welcome Page with Background Image */
              <div className="h-full w-full flex flex-col items-center justify-between p-8 relative overflow-hidden">
                {/* Full-screen background image */}
                <div
                  className="absolute inset-0 z-0 bg-cover bg-center bg-no-repeat"
                  style={{ backgroundImage: `url('${welcomeBackgroundUrl}')` }}
                >
                  {/* Preload image with error handling */}
                  <img
                    src={welcomeBackgroundUrl}
                    className="hidden"
                    onError={() => {
                      console.log(
                        "Background image failed to load, using fallback"
                      );
                      setBackgroundImgError(true);
                    }}
                    alt=""
                  />
                </div>

                {/* Error message - keep this for functionality */}
                {error && (
                  <div className="absolute top-8 left-1/2 transform -translate-x-1/2 bg-red-500/90 text-white px-6 py-3 rounded-lg shadow-lg max-w-lg text-center z-50">
                    <div className="font-bold mb-1">Error</div>
                    <div>{error}</div>
                    <Button
                      className="mt-2 bg-white text-red-500 hover:bg-gray-100"
                      size="sm"
                      onPress={() => setError(null)}
                    >
                      Dismiss
                    </Button>
                  </div>
                )}

                {/* Title text - moved to upper left */}
                <div className="relative z-10 w-full flex justify-start pt-12 pl-12">
                  <div className="text-5xl font-extrabold tracking-tight text-white">
                    <span className="bg-clip-text text-transparent bg-gradient-to-r from-white to-capgemini-blue">
                      {config.ui.welcomeTitle}
                    </span>
                  </div>
                </div>

                {/* Button positioned in the center of the page */}
                <div className="absolute top-1/4 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-10">
                  <Button
                    className={`${config.ui.startButtonClass} text-white text-2xl font-semibold rounded-xl h-20 px-12 w-fit hover:scale-105 transition-transform shadow-xl group`}
                    size="lg"
                    onPress={startSession}
                  >
                    <span className="mr-2">{config.ui.startButtonText}</span>
                    <span className="group-hover:translate-x-1 transition-transform">
                      →
                    </span>
                  </Button>
                </div>

                {/* Footer - preserved from original */}
                <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 flex items-center justify-center gap-1.5 z-10">
                  <div className="text-sm text-gray-200">
                    {config.ui.footerText}
                  </div>
                  <div className="w-1 h-1 bg-gray-200 rounded-full" />
                  <div className="text-sm text-gray-200">
                    <Button
                      className="p-0 min-w-0 h-auto bg-transparent text-gray-200 hover:text-white hover:underline"
                      size="sm"
                      variant="light"
                      onPress={onOpen}
                    >
                      Admin
                    </Button>
                  </div>
                </div>
              </div>
            )
          ) : (
            <div className="h-full w-full flex items-center justify-center relative overflow-hidden">
              {/* Full-screen background image */}
              <div
                className="absolute inset-0 z-0 bg-cover bg-center bg-no-repeat"
                style={{
                  backgroundImage: `url('${isLoadingSession ? loadingBackgroundUrl : welcomeBackgroundUrl}')`,
                }}
              >
                {/* Preload image with error handling */}
                <img
                  src={
                    isLoadingSession
                      ? loadingBackgroundUrl
                      : welcomeBackgroundUrl
                  }
                  className="hidden"
                  onError={() => {
                    console.log("Loading image failed to load, using fallback");
                    isLoadingSession
                      ? setLoadingImgError(true)
                      : setBackgroundImgError(true);
                  }}
                  alt=""
                />
              </div>

              {/* Semi-transparent container for better visibility */}
              <div className="relative z-10 bg-deep-purple-950/70 backdrop-blur-sm rounded-xl p-10 max-w-lg text-center shadow-2xl">
                {/* Loading spinner */}
                <Spinner className="mb-6" color="white" size="lg" />
                {/* Rotating loading messages */}
                <div className="h-16 flex items-center justify-center">
                  <div className="text-xl text-white font-light transition-opacity duration-500">
                    {
                      config.content.loadingMessages[
                        currentStarterIndex %
                          config.content.loadingMessages.length
                      ]
                    }
                  </div>
                </div>
              </div>

              {/* Error display - preserved for functionality */}
              {error && (
                <div className="absolute bottom-10 left-1/2 transform -translate-x-1/2 bg-white/90 backdrop-blur-sm text-gray-800 px-6 py-4 rounded-lg shadow-lg max-w-md z-20 border border-gray-200">
                  <div className="font-medium mb-2 text-lg flex items-center gap-2">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="2" y="4" width="20" height="16" rx="2" />
                      <path d="M10 9h4" />
                      <path d="M10 14h4" />
                    </svg>
                    Out of Office
                  </div>
                  <div className="text-gray-600">
                    Maya is out of office at the moment. Please try again in a
                    few minutes.
                  </div>
                  <Button
                    className="mt-4 bg-gray-100 text-gray-800 hover:bg-gray-200 border border-gray-300"
                    size="sm"
                    onPress={() => setError(null)}
                  >
                    Try Again
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardBody>

        {/* Show text input only when in text mode and stream is active */}
        {stream && chatMode === "text_mode" && (
          <>
            <Divider />
            <CardFooter className="flex flex-col gap-3 relative">
              <Tabs
                aria-label="Chat mode"
                selectedKey={chatMode}
                onSelectionChange={(v) => {
                  setChatMode(v as string);
                }}
              >
                <Tab key="text_mode" title="Text mode" />
                <Tab key="voice_mode" title="Voice mode" />
              </Tabs>
              <div className="w-full flex relative">
                <InteractiveAvatarTextInput
                  disabled={!stream}
                  input={text}
                  label="Chat"
                  loading={isLoadingRepeat}
                  placeholder="Type something for the avatar to respond"
                  setInput={setText}
                  onSubmit={handleSpeak}
                />
                {text && (
                  <Chip className="absolute right-16 top-3">Listening</Chip>
                )}
              </div>
            </CardFooter>
          </>
        )}
      </Card>
    </div>
  );
}
