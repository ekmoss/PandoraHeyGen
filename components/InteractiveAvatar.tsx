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
import type { AudioWorkerOutput } from "./audioWorker";

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
import Image from "next/image";

// Add these imports from streamingAudio
import {
  createStreamingSession,
  processAudioChunk,
  incrementChunkSequence,
  SessionInfo,
  DEFAULT_STREAMING_CONFIG,
  shouldProcessWithAI,
} from "@/app/lib/streamingAudio";

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
  const [microphoneStream, setMicrophoneStream] = useState<MediaStream | null>(
    null
  );

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

  // Audio recording state
  const [audioRecorder, setAudioRecorder] = useState<MediaRecorder | null>(
    null
  );
  const [audioChunks, setAudioChunks] = useState<Blob[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  // Add this near the top where other state variables are defined
  const logoPath = useMemo(() => {
    // Check if logo is defined in the config
    const configLogoPath = initialConfig?.ui.logo || "/logo.png";

    return configLogoPath;
  }, [initialConfig]);

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

  // Keyboard shortcut listener for admin panel
  useEffect(() => {
    let keySequence = "";
    const keyTimeout = 2000; // 2 seconds timeout for key sequence
    let timer: NodeJS.Timeout;

    const handleKeyDown = (e: KeyboardEvent) => {
      clearTimeout(timer);
      keySequence += e.key;

      // Check for the admin command sequence - "admin"
      if (keySequence.includes("admin")) {
        onOpen(); // Open the admin modal
        keySequence = "";
      }

      // Reset sequence after timeout
      timer = setTimeout(() => {
        keySequence = "";
      }, keyTimeout);
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      clearTimeout(timer);
    };
  }, [onOpen]);

  // Add a rotation effect for the starters during loading
  useEffect(() => {
    let interval: NodeJS.Timeout;

    if (isLoadingSession && !stream) {
      interval = setInterval(() => {
        setCurrentStarterIndex((prevIndex) =>
          prevIndex === conversationStarters.length - 1 ? 0 : prevIndex + 1
        );
      }, 3000); // Rotate every 3 seconds
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isLoadingSession, stream, conversationStarters.length]);

  useEffect(() => {
    if (
      !removeBackground ||
      !stream ||
      !mediaStream.current ||
      !canvasRef.current
    )
      return;

    const video = mediaStream.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d", {
      willReadFrequently: true,
      alpha: true,
    });

    if (!ctx) return;

    // Function to convert hex color to RGB
    const hexToRgb = (hex: string): number[] => {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return [r, g, b];
    };

    // Get target color in RGB
    const targetColor = hexToRgb(chromaKeyColor);

    const renderCanvas = () => {
      // Ensure dimensions match the video
      if (video.videoWidth > 0 && canvas.width !== video.videoWidth) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      for (let i = 0; i < data.length; i += 4) {
        const red = data[i];
        const green = data[i + 1];
        const blue = data[i + 2];

        // For black background, check if pixel is close to black
        if (
          isCloseToTargetColor(
            [red, green, blue],
            targetColor,
            chromaKeyThreshold
          )
        ) {
          data[i + 3] = 0; // Set alpha channel to 0 (transparent)
        }
      }

      ctx.putImageData(imageData, 0, 0);

      return requestAnimationFrame(renderCanvas);
    };

    const isCloseToTargetColor = (
      color: number[],
      target: number[],
      threshold: number
    ): boolean => {
      // For green backgrounds (common in chroma key)
      if (target[1] > 100 && target[1] > target[0] && target[1] > target[2]) {
        // Special case for green - check if green channel is dominant
        return (
          color[1] > color[0] + threshold && color[1] > color[2] + threshold
        );
      }

      // For other colors, calculate color distance
      const distance = Math.sqrt(
        Math.pow(color[0] - target[0], 2) +
          Math.pow(color[1] - target[1], 2) +
          Math.pow(color[2] - target[2], 2)
      );

      return distance < threshold;
    };

    const animationFrameId = renderCanvas();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [removeBackground, stream, chromaKeyColor, chromaKeyThreshold]);

  async function fetchAccessToken() {
    try {
      const response = await fetch("/api/get-access-token", {
        method: "POST",
      });
      const token = await response.text();

      console.log("Access Token:", token); // Log the token to verify

      return token;
    } catch (error) {
      console.error("Error fetching access token:", error);
    }

    return "";
  }

  // Set mounted state after initial render
  useEffect(() => {
    setIsMounted(true);
    return () => setIsMounted(false);
  }, []);

  // Protect media stream effects
  useEffect(() => {
    if (!isMounted || !stream || !mediaStream.current) return;

    try {
      mediaStream.current.srcObject = stream;
      mediaStream.current.onloadedmetadata = () => {
        if (!mediaStream.current) return;
        mediaStream.current.play().catch(console.error);
        setDebug("Playing");
      };
    } catch (err) {
      console.error("Error setting up media stream:", err);
    }
  }, [isMounted, stream]);

  // Protect microphone initialization
  useEffect(() => {
    if (!isMounted || !stream) return;

    let cleanup = () => {};

    const initializeMicrophone = async () => {
      try {
        console.log("Setting up direct microphone control...");
        const micStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });

        if (!isMounted) {
          micStream.getTracks().forEach((track) => track.stop());
          return;
        }

        originalMicRef.current = micStream.getAudioTracks()[0];
        originalMicRef.current.enabled = false;
        setIsOriginalMicConnected(true);
        setMicrophoneStream(micStream);

        cleanup = () => {
          micStream.getTracks().forEach((track) => track.stop());
        };

        console.log(
          "Direct microphone control initialized - initially disabled"
        );
      } catch (error) {
        console.error("Error setting up direct microphone control:", error);
        setMicError("Microphone access required");
      }
    };

    initializeMicrophone();

    return () => cleanup();
  }, [isMounted, stream]);

  // Protect the startSession function
  async function startSession() {
    if (!isMounted) return;

    setIsLoadingSession(true);
    setError(null);

    try {
      const newToken = await fetchAccessToken();
      if (!newToken) {
        console.error("Failed to get access token");
        setError(
          "Maya is out of office at the moment. Please try again in a few minutes."
        );
        setIsLoadingSession(false);
        return;
      }

      if (!isMounted) return; // Check mounted state again after async operation

      avatar.current = new StreamingAvatar({
        token: newToken,
      });

      // Setup event listeners
      avatar.current.on(StreamingEvents.AVATAR_START_TALKING, (e) => {
        console.log("Avatar started talking", e);
      });
      avatar.current.on(StreamingEvents.AVATAR_STOP_TALKING, (e) => {
        console.log("Avatar stopped talking", e);
      });
      avatar.current.on(StreamingEvents.STREAM_DISCONNECTED, () => {
        console.log("Stream disconnected");
        endSession();
      });
      avatar.current?.on(StreamingEvents.STREAM_READY, (event) => {
        console.log(">>>>> Stream ready:", event.detail);
        setStream(event.detail);

        // IMPORTANT: We'll manually initialize our microphone control
        // rather than letting the SDK handle it
        setTimeout(async () => {
          try {
            // This gives us a clean slate for microphone control
            if (avatar.current) {
              await avatar.current.stopListening();
              console.log("Temporarily stopped SDK listening");

              // Custom initialization
              setTimeout(async () => {
                const micStream = await navigator.mediaDevices.getUserMedia({
                  audio: true,
                  video: false,
                });
                originalMicRef.current = micStream.getAudioTracks()[0];
                originalMicRef.current.enabled = false;
                setIsOriginalMicConnected(true);
                setMicrophoneStream(micStream);
                console.log("Direct mic control initialized");
              }, 500);
            }
          } catch (e) {
            console.error("Error in custom mic initialization:", e);
          }
        }, 300);
      });
      avatar.current?.on(StreamingEvents.USER_START, (event) => {
        console.log(">>>>> User started talking:", event);
        setIsUserTalking(true);
      });
      avatar.current?.on(StreamingEvents.USER_STOP, (event) => {
        console.log(">>>>> User stopped talking:", event);
        setIsUserTalking(false);
      });

      const res = await avatar.current.createStartAvatar({
        quality: AvatarQuality.High,
        avatarName: avatarId,
        knowledgeId: knowledgeId,
        voice: {
          rate: 0.9,
          emotion: VoiceEmotion.FRIENDLY,
        },
        language: language,
        disableIdleTimeout: true,
      });

      setData(res);

      // Remove voice chat initialization
      setChatMode("voice_mode");

      // IMPORTANT: Wait for the avatar to fully initialize before setting up mic
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Explicitly disable microphone on startup
      try {
        console.log("Explicitly disabling microphone on startup");
        if (avatar.current) {
          await avatar.current.stopListening();
        }
        console.log("Initial microphone state: disabled");
      } catch (initError) {
        console.error("Error during initial microphone setup:", initError);
      }
    } catch (error) {
      console.error("Error starting session:", error);
      setError(
        "Maya is out of office at the moment. Please try again in a few minutes."
      );
    } finally {
      if (isMounted) {
        setIsLoadingSession(false);
      }
    }
  }

  async function handleSpeak() {
    setIsLoadingRepeat(true);
    if (!avatar.current) {
      setDebug("Avatar API not initialized");

      return;
    }
    await avatar.current?.speak({ text });
    setIsLoadingRepeat(false);
  }

  async function handleInterrupt() {
    if (!avatar.current) {
      setDebug("Avatar API not initialized");

      return;
    }
    await avatar.current.interrupt().catch((e) => {
      setDebug(e.message);
    });
  }

  const endSession = useCallback(async () => {
    try {
      // Exit fullscreen if active
      if (isFullscreen) {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if ((document as any).webkitExitFullscreen) {
          await (document as any).webkitExitFullscreen();
        } else if ((document as any).mozCancelFullScreen) {
          await (document as any).mozCancelFullScreen();
        } else if ((document as any).msExitFullscreen) {
          await (document as any).msExitFullscreen();
        }
        setIsFullscreen(false);
      }

      // Use the correct method to end the session
      if (avatar.current) {
        await avatar.current.stopAvatar();
        avatar.current = null;
      }
      setStream(undefined);
      setData(undefined);
      setDebug(undefined);
      setIsUserTalking(false);
      setIsPushingToTalk(false);

      // Reset any other state
      setError(null);
    } catch (err) {
      console.error("Error ending session:", err);
      setError("Failed to end session properly. Please refresh the page.");
    }
  }, [isFullscreen]);

  const handleChangeChatMode = useMemoizedFn(async (v) => {
    if (v === chatMode) {
      return;
    }
    if (v === "text_mode") {
      avatar.current?.closeVoiceChat();
    } else {
      await avatar.current?.startVoiceChat();
    }
    setChatMode(v);
  });

  const toggleFullscreen = () => {
    if (!isFullscreen) {
      if (videoContainerRef.current?.requestFullscreen) {
        videoContainerRef.current.requestFullscreen().catch((err) => {
          setDebug(`Error attempting to enable fullscreen: ${err.message}`);
        });
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch((err) => {
          setDebug(`Error attempting to exit fullscreen: ${err.message}`);
        });
      }
    }
  };

  // Clean up any microphone resources when component unmounts
  useEffect(() => {
    return () => {
      // Make sure microphone is released when component unmounts
      if (microphoneStream) {
        microphoneStream.getTracks().forEach((track) => {
          track.stop();
        });
      }
    };
  }, [microphoneStream]);

  // Ensure the avatar is muted on initial load
  useEffect(() => {
    // Mute the avatar immediately after initialization
    const initializeAvatarMicState = async () => {
      if (avatar.current) {
        try {
          console.log("Initializing avatar mic state to muted");
          // Small delay to ensure avatar is ready
          await new Promise((resolve) => setTimeout(resolve, 1000));
          await avatar.current.stopListening();
          console.log("Avatar initially muted");
        } catch (error) {
          console.error("Error muting on initialization:", error);
        }
      }
    };

    initializeAvatarMicState();
  }, []);

  // Add to the existing state variables
  const audioWorkerRef = useRef<Worker | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const processingMetrics = useRef<Record<string, number>>({});
  const recordingStartTimeRef = useRef<number>(0);

  // Add this helper function for performance logging
  const logPerformance = useCallback(
    (step: string, startTime: number, endTime: number) => {
      const duration = endTime - startTime;
      processingMetrics.current[step] = duration;
      console.log(`Performance Metric - ${step}: ${duration.toFixed(2)}ms`);
      return duration;
    },
    []
  );

  // After the other useEffect hooks, add a new one for WebWorker initialization
  useEffect(() => {
    if (!isMounted) return;

    // Create the audio processing worker
    let audioWorker: Worker | null = null;

    try {
      // Create worker with a dynamic import
      audioWorker = new Worker(new URL("./audioWorker.ts", import.meta.url), {
        type: "module",
      });
      audioWorkerRef.current = audioWorker;
      console.log("Audio processing worker initialized");
    } catch (error) {
      console.error("Error initializing audio worker:", error);
    }

    // Setup API connection pre-warming
    const warmUpAPIs = async () => {
      console.log("Pre-emptively warming up API connections...");

      // Pre-connect to both APIs to establish TCP connections
      await Promise.all([
        // Use the transcribe-chunk API endpoint like in StreamingVoiceTest
        fetch("/api/transcribe-chunk", {
          method: "HEAD",
          headers: { Connection: "keep-alive" },
        }).catch(() => {}),

        // Also warm up the direct transcribe API
        fetch("/api/transcribe", {
          method: "HEAD",
          headers: { Connection: "keep-alive" },
        }).catch(() => {}),

        fetch("/api/chat", {
          method: "HEAD",
          headers: { Connection: "keep-alive" },
        }).catch(() => {}),
      ]);

      console.log("API connections pre-established");
    };

    // Pre-warm connections immediately
    warmUpAPIs();

    // Set up recurring warm-up every 2 minutes
    const keepAliveInterval = setInterval(warmUpAPIs, 120000);

    // Clean up
    return () => {
      if (audioWorker) {
        audioWorker.terminate();
        console.log("Audio processing worker terminated");
      }
      clearInterval(keepAliveInterval);
    };
  }, [isMounted]);

  // Add session state
  const [sessionInfo, setSessionInfo] = useState<SessionInfo>(
    createStreamingSession
  );

  // Update the getSupportedMimeType function to match StreamingVoiceTest
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

  // Add a function to handle transcription results
  const handleTranscriptionResult = useCallback(
    async (transcribedText: string, aiResponse: string) => {
      console.log(`Transcription result: "${transcribedText}"`);

      // Update the text state
      setText(transcribedText);

      // Have avatar speak the response
      console.log("Requesting avatar to speak response...");
      const speakStart = performance.now();

      if (avatar.current) {
        try {
          await avatar.current.speak({
            text: aiResponse,
            taskType: TaskType.REPEAT,
            taskMode: TaskMode.SYNC,
          });
          console.log("Avatar speech completed");
        } catch (speakError) {
          console.error("Error during avatar speech:", speakError);
        }
      } else {
        console.error("Avatar reference not available");
      }

      const speakEnd = performance.now();
      console.log(
        `Avatar speaking took: ${(speakEnd - speakStart).toFixed(2)}ms`
      );

      // Log total interaction time after speaking
      const totalTime = performance.now() - recordingStartTimeRef.current;
      console.log(`Total interaction time: ${totalTime.toFixed(2)}ms`);
    },
    []
  );

  // Update the initializeRecorder function to use the handleTranscriptionResult
  function initializeRecorder(stream: MediaStream) {
    // Set up recorder with optimized settings for low latency
    const options = {
      mimeType: getSupportedMimeType(),
      audioBitsPerSecond: DEFAULT_STREAMING_CONFIG.audioBitsPerSecond,
    };

    // Create new session when recording starts
    setSessionInfo(createStreamingSession());

    // Clear existing chunks
    audioChunksRef.current = [];
    let recorder: MediaRecorder;

    try {
      recorder = new MediaRecorder(stream, options);
    } catch (e) {
      console.log(
        "MediaRecorder not supported with these options, falling back to default"
      );
      recorder = new MediaRecorder(stream);
    }

    // Flag to coordinate between onstop and ondataavailable
    let isStopping = false;
    let finalChunkReceived = false;
    let pendingProcessing = false;

    // Enhanced data handling with chunk size logging
    recorder.ondataavailable = async (e) => {
      console.log(
        `MediaRecorder ondataavailable event triggered, data size: ${e.data.size} bytes`
      );
      if (e.data && e.data.size > 0) {
        // Store the chunk in our ref
        if (!audioChunksRef.current) {
          audioChunksRef.current = [];
        }
        audioChunksRef.current.push(e.data);

        const totalChunks = audioChunksRef.current.length;
        console.log(
          `Audio chunk added to buffer, total chunks: ${totalChunks}`
        );

        // Only process if this is an interim chunk (not during stopping)
        // and it's large enough to likely contain speech
        if (
          !isStopping &&
          e.data.size >= DEFAULT_STREAMING_CONFIG.minChunkSize * 1.5
        ) {
          try {
            const chunkStart = performance.now();

            // Process the chunk with the latest session info
            const chunkResult = await processAudioChunk(
              e.data,
              sessionInfo,
              false // Not the last chunk
            );

            const chunkEnd = performance.now();
            console.log(
              `Process interim chunk took: ${(chunkEnd - chunkStart).toFixed(2)}ms`
            );

            // Only update for meaningful results
            if (chunkResult?.error) {
              console.warn(
                "Error processing interim chunk:",
                chunkResult.error
              );
              // Don't show interim errors to avoid UI noise
            } else if (chunkResult?.text) {
              console.log("Interim transcription:", chunkResult.text);
              // Update session for next chunk
              setSessionInfo(incrementChunkSequence(sessionInfo));
            }
          } catch (error) {
            console.error("Error in chunk processing:", error);
          }
        }
        // If we're stopping and just received a chunk, do final processing
        else if (isStopping && !pendingProcessing) {
          finalChunkReceived = true;
          pendingProcessing = true;

          console.log("Final chunk received, starting processing");
          try {
            // Process the recorded audio when recording stops
            const result = await processRecordedAudio();

            // Handle the result
            if (result) {
              await handleTranscriptionResult(
                result.transcribedText,
                result.aiResponse
              );
            }
          } catch (error) {
            console.error(
              "Error processing audio in ondataavailable handler:",
              error
            );
          } finally {
            pendingProcessing = false;
          }
        }
      }
    };

    // Record for 250ms chunks for more responsive experience
    recorder.start(DEFAULT_STREAMING_CONFIG.chunkDuration);
    console.log(
      `MediaRecorder started with ${DEFAULT_STREAMING_CONFIG.chunkDuration}ms timeslice`
    );

    recorder.onstop = async () => {
      console.log(`MediaRecorder stopped, waiting for final chunks...`);
      isStopping = true;

      // If we already have all chunks (finalChunkReceived was set in ondataavailable)
      // then we've already processed the audio and don't need to do anything
      if (finalChunkReceived) {
        console.log(
          "Final processing already completed in ondataavailable handler"
        );
        return;
      }

      // Set a timeout to ensure processing happens even if no more ondataavailable events fire
      setTimeout(async () => {
        if (!pendingProcessing) {
          console.log("Timeout reached, processing existing chunks");
          pendingProcessing = true;

          if (!audioChunksRef.current || audioChunksRef.current.length === 0) {
            console.log("No audio chunks to process after recording stopped");
            setIsProcessing(false);
            return;
          }

          try {
            // Process the recorded audio when recording stops
            const result = await processRecordedAudio();

            // Handle the result
            if (result) {
              await handleTranscriptionResult(
                result.transcribedText,
                result.aiResponse
              );
            }
          } catch (error) {
            console.error(
              "Error processing audio in onstop timeout handler:",
              error
            );
          } finally {
            pendingProcessing = false;
          }
        }
      }, 300); // 300ms timeout should be enough for final chunks to arrive
    };

    return recorder;
  }

  // Optimize the processRecordedAudio function to focus on the streaming approach
  async function processRecordedAudio(): Promise<{
    transcribedText: string;
    aiResponse: string;
  } | null> {
    if (!audioChunksRef.current || audioChunksRef.current.length === 0) {
      console.log("No audio chunks to process");
      return null;
    }

    try {
      setIsProcessing(true);
      const startTime = performance.now();

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

      // Create combined blob from all chunks using the first chunk's type
      const blobStartTime = performance.now();
      const combinedBlob = new Blob(audioChunksRef.current, {
        type: audioChunksRef.current[0]?.type || "audio/webm",
      });

      console.log(
        `Combined audio blob created: ${(combinedBlob.size / 1024).toFixed(2)}KB, combining took ${(performance.now() - blobStartTime).toFixed(2)}ms`
      );

      // Process the final chunk using processAudioChunk from streamingAudio
      // This is our primary approach for all audio processing
      const processingStart = performance.now();
      const finalChunkResult = await processAudioChunk(
        combinedBlob,
        sessionInfo,
        true // This is the final chunk
      );

      console.log(
        `Audio processing through streaming API took: ${(performance.now() - processingStart).toFixed(2)}ms`
      );

      console.log("Final chunk processing result:", {
        hasText: !!finalChunkResult?.text,
        hasError: !!finalChunkResult?.error,
        metrics: finalChunkResult?.metrics,
      });

      // If we have an error from the streaming API, log and rethrow
      if (finalChunkResult?.error) {
        throw new Error(`Transcription error: ${finalChunkResult.error}`);
      }

      // If we got text back, use it
      if (finalChunkResult?.text) {
        const transcribedText = finalChunkResult.text;
        console.log("Transcribed text:", transcribedText);

        if (!transcribedText || transcribedText.trim() === "") {
          console.log("No transcription received");
          return null;
        }

        // Then, get the AI response
        const aiResponse = await fetchChatResponse(transcribedText);
        console.log("AI response:", aiResponse);

        const totalTime = performance.now() - startTime;
        console.log(`Total processing time: ${totalTime.toFixed(2)}ms`);

        return { transcribedText, aiResponse };
      }

      // If we got here, something went wrong but no error was thrown
      console.error(
        "No transcription text returned, but no error was reported"
      );
      return null;
    } catch (error) {
      console.error("Error processing audio:", error);
      return null;
    } finally {
      setIsProcessing(false);
    }
  }

  // Update the fetchChatResponse function to better handle errors and include metrics
  async function fetchChatResponse(message: string): Promise<string> {
    const chatStartTime = performance.now();
    console.log("Calling chat API with transcription:", message);

    try {
      // Call the chat API with proper error handling
      const response = await fetch("/api/chat", {
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
        // Add timeout signal for better error handling
        signal: AbortSignal.timeout(10000), // 10-second timeout
      });

      if (!response.ok) {
        // Handle specific error cases
        if (response.status === 429) {
          throw new Error("Rate limit exceeded. Please try again in a moment.");
        } else if (response.status === 500) {
          throw new Error(
            "Server error processing your request. Please try again."
          );
        } else {
          throw new Error(`Chat API failed: ${response.status}`);
        }
      }

      const data = await response.json();

      // Log metrics if available
      if (data.metrics) {
        console.log("Chat API metrics:", data.metrics);
        // Store metrics in the processingMetrics ref (similar to StreamingVoiceTest)
        Object.entries(data.metrics).forEach(([key, value]) => {
          if (typeof value === "number") {
            processingMetrics.current[`chat_${key}`] = value;
          }
        });
      }

      const chatEndTime = performance.now();
      const totalChatTime = chatEndTime - chatStartTime;
      console.log(`Total chat API time: ${totalChatTime.toFixed(2)}ms`);
      processingMetrics.current["chat_total_time"] = totalChatTime;

      // Extract response depending on the format returned
      return (
        data.response ||
        (data.choices && data.choices[0]?.message?.content) ||
        "I'm sorry, I couldn't process that request."
      );
    } catch (error) {
      console.error("Error fetching chat response:", error);

      // More informative error messages
      if (error instanceof TypeError && error.message.includes("fetch")) {
        return "Sorry, I'm having trouble connecting to my knowledge base. Please check your internet connection.";
      } else if (error instanceof DOMException && error.name === "AbortError") {
        return "Sorry, the request took too long to process. Please try a shorter message.";
      }

      return "Sorry, I encountered an error processing your request.";
    }
  }

  // Update the handlePushToTalkClick function to include performance metrics
  const handlePushToTalkClick = async () => {
    // Record performance metrics
    const clickTime = performance.now();
    console.log(`Push-to-talk button clicked at ${new Date().toISOString()}`);

    if (!isPushingToTalk) {
      const startButtonTime = performance.now();
      await startPushToTalk();
      console.log(
        `Start push-to-talk took: ${(performance.now() - startButtonTime).toFixed(2)}ms`
      );
    } else {
      const stopButtonTime = performance.now();
      await stopPushToTalk();
      console.log(
        `Stop push-to-talk took: ${(performance.now() - stopButtonTime).toFixed(2)}ms`
      );
    }

    console.log(
      `Total button interaction took: ${(performance.now() - clickTime).toFixed(2)}ms`
    );
  };

  // Update the startPushToTalk function to use the optimized audio stream
  async function startPushToTalk() {
    if (!isMounted) return;

    try {
      const startTime = performance.now();
      // Start recording
      console.log("Starting recording...");
      setMicError(null); // Clear any previous errors

      // Use the optimized audio stream settings
      const stream = await getAudioStream();
      const mediaTime = performance.now();
      console.log(`Media access took: ${(mediaTime - startTime).toFixed(2)}ms`);

      // Initialize recorder - this now internally starts the recorder
      const recorder = initializeRecorder(stream);
      const recorderTime = performance.now();
      console.log(
        `Recorder initialization took: ${(recorderTime - mediaTime).toFixed(2)}ms`
      );

      // Update state
      setAudioRecorder(recorder);
      setIsPushingToTalk(true);

      // Store start time for latency calculation
      recordingStartTimeRef.current = performance.now();
      console.log(
        `Total start recording took: ${(performance.now() - startTime).toFixed(2)}ms`
      );
    } catch (error) {
      console.error("Error starting push-to-talk:", error);
      setMicError("Failed to access microphone");
    }
  }

  // Update stopPushToTalk function to work with the new flow
  async function stopPushToTalk() {
    if (!isMounted) return;

    try {
      const stopTime = performance.now();
      console.log("Stopping recording...");

      // Calculate recording duration
      const recordingDuration = stopTime - recordingStartTimeRef.current;
      console.log(`Recording duration: ${recordingDuration.toFixed(2)}ms`);

      // Update UI state first
      setIsPushingToTalk(false);
      setIsProcessing(true);

      // Stop the recorder
      // This will trigger the onstop event which coordinates with ondataavailable
      // to ensure we only process the audio once
      if (audioRecorder && audioRecorder.state !== "inactive") {
        console.log("Stopping MediaRecorder...");
        audioRecorder.stop();
        const stopRecorderTime = performance.now();
        console.log(
          `Stop recorder took: ${(stopRecorderTime - stopTime).toFixed(2)}ms`
        );
      } else {
        console.log("MediaRecorder already inactive or not available");
        setIsProcessing(false);
      }

      // Note: We don't call processRecordedAudio() here anymore
      // That's now handled by the coordination between onstop and ondataavailable events

      // Clean up recorder state - this should happen after processing is complete
      // but we can't await the processing here because it's happening asynchronously
      // after the final chunk is received
      setTimeout(() => {
        if (audioRecorder) {
          const tracks = audioRecorder.stream.getTracks();
          tracks.forEach((track) => track.stop());
          console.log("Audio recording tracks cleaned up");
        }
        // Only clear the recorder reference after processing is done
        if (!isProcessing) {
          setAudioRecorder(null);
        }
      }, 1000); // Give enough time for processing to complete
    } catch (error) {
      console.error("Error in stopPushToTalk:", error);
      setMicError("Error processing your voice");
      setIsProcessing(false);
    }
  }

  // Update the getAudioStream function to optimize audio settings for speech recognition
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
      console.log(
        `Get Audio Stream took ${(endTime - startTime).toFixed(2)}ms`
      );
      return stream;
    } catch (error) {
      console.error("Error accessing microphone:", error);
      const endTime = performance.now();
      console.log(
        `Get Audio Stream (Failed) took ${(endTime - startTime).toFixed(2)}ms`
      );
      throw new Error(
        "Failed to access microphone. Please ensure microphone permissions are granted."
      );
    }
  }, []);

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
  }, []);

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
                  handleChangeChatMode(v);
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
