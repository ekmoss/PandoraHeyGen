"use client";

/* eslint-disable no-console */
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
import Image from "next/image";

interface InteractiveAvatarProps {
  initialConfig: AppConfig;
}

export default function InteractiveAvatar({
  initialConfig,
}: InteractiveAvatarProps) {
  // Use the provided configuration
  const config = initialConfig;

  const [isLoadingSession, setIsLoadingSession] = useState(false);
  const [isLoadingRepeat, setIsLoadingRepeat] = useState(false);
  const [stream, setStream] = useState<MediaStream>();
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
    config.avatar.chromaKeyThreshold || 30
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
  const [avatarBackground, setavatarBackground] = useState<string>(
    "/bg-office.png" // Set your default background image path here
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

  async function startSession() {
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

      // Start the session but DON'T automatically connect to microphone
      await avatar.current.startVoiceChat();

      setChatMode("voice_mode");

      // IMPORTANT: Wait for the avatar to fully initialize before setting up mic
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Explicitly disable microphone on startup
      // This ensures the avatar doesn't listen until the user clicks the button
      try {
        console.log("Explicitly disabling microphone on startup");
        await avatar.current.closeVoiceChat();
        await avatar.current.stopListening();
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
      setIsLoadingSession(false);
    }
  }

  async function handleSpeak() {
    setIsLoadingRepeat(true);
    if (!avatar.current) {
      setDebug("Avatar API not initialized");

      return;
    }
    // speak({ text: text, task_type: TaskType.REPEAT })
    await avatar.current
      .speak({ text: text, taskType: TaskType.REPEAT, taskMode: TaskMode.SYNC })
      .catch((e) => {
        setDebug(e.message);
      });
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

  // Fixed toggle function with loading state
  const handlePushToTalkToggle = useCallback(async () => {
    // Debounce
    const now = Date.now();
    if (now - lastToggleTime < 500) return;
    setLastToggleTime(now);
    setMicError(null);

    try {
      if (!avatar.current) {
        console.log("Avatar not available");
        setMicError("Maya can't hear you right now");
        return;
      }

      if (isPushingToTalk) {
        // MUTE - close voice chat first, then stop listening
        console.log("Muting microphone");
        setIsPushingToTalk(false); // Update UI immediately

        try {
          // First close voice chat
          await avatar.current.closeVoiceChat();
          console.log("Voice chat closed successfully");

          // Small delay before stopping listening
          await new Promise((resolve) => setTimeout(resolve, 100));

          // Then stop listening
          await avatar.current.stopListening();
          console.log("Listening stopped successfully");
        } catch (error) {
          console.error("Error while muting:", error);
          // Continue despite errors - we've already updated UI
        }
      } else {
        // UNMUTE with loading state
        console.log("Preparing to unmute microphone");
        setIsLoading(true); // Show loading state

        try {
          // Make sure voice chat is closed first
          await avatar.current.closeVoiceChat();
          console.log("Existing voice chat closed");

          // Reduce first delay or remove if possible
          await new Promise((resolve) => setTimeout(resolve, 50)); // Reduced from 300ms

          // Start voice chat
          await avatar.current.startVoiceChat();
          console.log("Voice chat started successfully");

          // Start listening
          await avatar.current.startListening();
          console.log("Listening started successfully");

          // Only update UI after everything is ready
          setIsPushingToTalk(true);
          setIsLoading(false);
        } catch (error) {
          console.error("Error while unmuting:", error);
          setMicError("Microphone connection issue");
          setIsLoading(false);
        }
      }
    } catch (error) {
      console.error("Error toggling microphone:", error);
      setMicError("Failed to toggle microphone");
      setIsLoading(false);
    }
  }, [isPushingToTalk, lastToggleTime]);

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
    if (stream && mediaStream.current) {
      mediaStream.current.srcObject = stream;
      mediaStream.current.onloadedmetadata = () => {
        mediaStream.current!.play();
        setDebug("Playing");
      };
    }
  }, [mediaStream, stream]);

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

  // Initial setup when stream is ready
  useEffect(() => {
    if (stream) {
      (async () => {
        try {
          console.log("Setting up direct microphone control...");

          // Get microphone access
          const micStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: false,
          });

          // Store reference to the original microphone track
          originalMicRef.current = micStream.getAudioTracks()[0];

          // Start with microphone disabled
          originalMicRef.current.enabled = false;
          setIsOriginalMicConnected(true);

          setMicrophoneStream(micStream);
          console.log(
            "Direct microphone control initialized - initially disabled"
          );
        } catch (error) {
          console.error("Error setting up direct microphone control:", error);
          setMicError("Microphone access required");
        }
      })();
    }

    return () => {
      // Cleanup microphone
      if (microphoneStream) {
        microphoneStream.getTracks().forEach((track) => {
          track.stop();
        });
      }
    };
  }, [stream]);

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
                    onLoadingComplete={() =>
                      console.log("Background image loaded successfully")
                    }
                    onError={() =>
                      console.error("Background image failed to load")
                    }
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
                    className={`rounded-2xl h-16 px-8 py-4 flex items-center gap-3 shadow-lg transition-all ${
                      isPushingToTalk
                        ? "bg-gradient-to-r from-red-500 to-red-600 text-white"
                        : "bg-gradient-to-r from-capgemini-blue to-deep-purple-500 text-white"
                    } ${isLoading ? "loading" : ""}`}
                    size="lg"
                    onPress={handlePushToTalkToggle}
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
