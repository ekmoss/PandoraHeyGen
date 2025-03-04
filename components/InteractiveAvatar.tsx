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
import { useEffect, useRef, useState, useCallback } from "react";
import { useMemoizedFn, usePrevious } from "ahooks";

import InteractiveAvatarTextInput from "./InteractiveAvatarTextInput";

import { AVATARS, STT_LANGUAGE_LIST } from "@/app/lib/constants";

export default function InteractiveAvatar() {
  const [isLoadingSession, setIsLoadingSession] = useState(false);
  const [isLoadingRepeat, setIsLoadingRepeat] = useState(false);
  const [stream, setStream] = useState<MediaStream>();
  const [debug, setDebug] = useState<string>();
  const [knowledgeId, setKnowledgeId] = useState<string>(
    process.env.NEXT_PUBLIC_DEFAULT_KNOWLEDGE_ID || ""
  );
  const [avatarId, setAvatarId] = useState<string>(
    process.env.NEXT_PUBLIC_DEFAULT_AVATAR_ID || "avatar_glvzQVkGjW8RkBQKn3gL"
  );
  const [language, setLanguage] = useState<string>(
    process.env.NEXT_PUBLIC_DEFAULT_LANGUAGE || "en-US"
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
  const avatar = useRef<StreamingAvatar | null>(null);
  const [chatMode, setChatMode] = useState("voice_mode"); // Default to voice mode for touch interaction
  const [isUserTalking, setIsUserTalking] = useState(false);
  const [adminAccessCode, setAdminAccessCode] = useState("");
  const adminCode = "capgemini123"; // Simple admin access code

  // Add new state for conversation starters
  const [currentStarterIndex, setCurrentStarterIndex] = useState(0);
  const conversationStarters = [
    "Who are you and what can you do?",
    "What's one idea from Technovision I can take to clients in my industry?",
    "Write a poem for me",
    "Tell me about Capgemini's AI capabilities",
    "What industries does Capgemini work with?",
  ];

  // Add these new state variables near the other state declarations
  const [lastToggleTime, setLastToggleTime] = useState(0);
  const [isMicrophoneEnabled, setIsMicrophoneEnabled] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);

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
    setError(null); // Clear any previous errors

    try {
      const newToken = await fetchAccessToken();

      if (!newToken) {
        setError(
          "Failed to get access token. Please check your API key and try again."
        );
        setIsLoadingSession(false);

        return;
      }

      avatar.current = new StreamingAvatar({
        token: newToken,
      });
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
          rate: 1.0,
          emotion: VoiceEmotion.FRIENDLY,
        },
        language: language,
        disableIdleTimeout: true,
      });

      setData(res);
      // default to voice mode
      await avatar.current?.startVoiceChat({
        useSilencePrompt: false,
      });
      setChatMode("voice_mode");
    } catch (error) {
      console.error("Error starting avatar session:", error);
      if (error instanceof Error) {
        setError(`Failed to start avatar: ${error.message}`);
      } else {
        setError(
          "Failed to start avatar session. Please try again or check your configuration."
        );
      }
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

  const handlePushToTalkToggle = useCallback(() => {
    // Debounce to prevent rapid toggling (minimum 500ms between toggles)
    const now = Date.now();

    if (now - lastToggleTime < 500) {
      console.log("Toggling too fast, ignoring");

      return;
    }

    setLastToggleTime(now);
    setMicError(null);

    if (isPushingToTalk) {
      // If currently active, turn it off
      console.log("Stopping microphone...");
      setIsPushingToTalk(false);

      try {
        if (avatar.current) {
          avatar.current.stopListening();
          console.log("Microphone stopped via SDK");
        }
        setIsMicrophoneEnabled(false);
      } catch (error) {
        console.error("Error stopping microphone:", error);
        setMicError("Failed to stop microphone");
      }
    } else {
      // If currently inactive, turn it on
      console.log("Starting microphone...");

      try {
        if (avatar.current && stream) {
          setIsPushingToTalk(true);

          // Slight delay to ensure the UI updates before potentially heavy API operations
          setTimeout(() => {
            try {
              avatar.current?.startListening();
              console.log("Microphone started via SDK");
              setIsMicrophoneEnabled(true);
            } catch (error) {
              console.error("Error starting microphone:", error);
              setIsPushingToTalk(false);
              setMicError("Failed to start microphone");
            }
          }, 100);
        } else {
          console.warn("Avatar or stream not ready, can't enable microphone");
          setMicError("Avatar not ready");
        }
      } catch (error) {
        console.error("Error in microphone toggle:", error);
        setMicError("Microphone error");
      }
    }
  }, [isPushingToTalk, lastToggleTime, stream]);

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

  return (
    <div className="w-full h-full flex flex-col">
      {/* Admin authentication modal */}
      <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">
            Admin Access
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
              {/* Video container - made full screen */}
              <div ref={videoContainerRef} className="w-full h-full relative">
                {/* Avatar video element */}
                <video
                  ref={mediaStream}
                  autoPlay
                  playsInline
                  className="w-full h-full object-cover"
                >
                  <track kind="captions" />
                </video>

                {/* Name label in top-left corner */}
                <div className="absolute top-4 left-4 bg-deep-purple-950/70 backdrop-blur-sm px-4 py-2 rounded-lg z-10">
                  <span className="text-white text-xl font-medium">Maya</span>
                </div>

                {/* Control buttons in top-right corner */}
                <div className="absolute top-4 right-4 flex gap-2 z-10">
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
                <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 z-10">
                  <Button
                    className={`rounded-full h-16 px-8 py-4 flex items-center gap-3 shadow-lg transition-all ${
                      isPushingToTalk
                        ? "bg-gradient-to-r from-red-500 to-red-600 text-white"
                        : "bg-gradient-to-r from-capgemini-blue to-deep-purple-500 text-white"
                    }`}
                    size="lg"
                    onPress={handlePushToTalkToggle}
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
                      {isPushingToTalk ? "Tap to Stop" : "Tap to Talk"}
                    </span>
                  </Button>
                </div>

                {/* Error indicator */}
                {error && (
                  <div className="absolute bottom-24 left-1/2 transform -translate-x-1/2 bg-red-500/90 text-white px-6 py-3 rounded-lg shadow-lg max-w-md z-20 text-center">
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
                  style={{ backgroundImage: "url('/bg-maya.png')" }}
                />

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
                      Meet Maya
                    </span>
                  </div>
                </div>

                {/* Button positioned in the center of the page */}
                <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-10">
                  <Button
                    className="bg-gradient-to-tr from-capgemini-blue to-deep-purple-500 text-white text-xl font-semibold rounded-full h-16 px-12 w-64 hover:scale-105 transition-transform shadow-xl group"
                    size="lg"
                    onPress={startSession}
                  >
                    <span className="mr-2">Start Conversation</span>
                    <span className="group-hover:translate-x-1 transition-transform">
                      →
                    </span>
                  </Button>
                </div>

                {/* Footer - preserved from original */}
                <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 flex items-center justify-center gap-1.5 z-10">
                  <div className="text-sm text-gray-200">
                    Powered by Capgemini
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
                style={{ backgroundImage: "url('/bg-blank.jpg')" }}
              />

              {/* Semi-transparent container for better visibility */}
              <div className="relative z-10 bg-deep-purple-950/70 backdrop-blur-sm rounded-xl p-10 max-w-lg text-center shadow-2xl">
                {/* Loading spinner */}
                <Spinner className="mb-6" color="white" size="lg" />

                {/* Rotating loading messages */}
                <div className="h-16 flex items-center justify-center">
                  <div className="text-xl text-white font-light transition-opacity duration-500">
                    {
                      [
                        "Initializing your interactive avatar...",
                        "Warming up my neural networks...",
                        "Brewing a cup of digital coffee...",
                        "Polishing my conversation skills...",
                        "Loading Capgemini expertise...",
                        "Thinking outside the algorithmic box...",
                        "Onboarding new conversation topics...",
                        "Calibrating my virtual personality...",
                        "Preparing a digital transformation of this conversation...",
                        "Practicing my thoughtful nodding animation...",
                      ][currentStarterIndex % 10]
                    }
                  </div>
                </div>
              </div>

              {/* Error display - preserved for functionality */}
              {error && (
                <div className="absolute bottom-10 left-1/2 transform -translate-x-1/2 bg-red-500/90 text-white px-6 py-4 rounded-lg shadow-lg max-w-md z-20">
                  <div className="font-bold mb-1 text-lg">Connection Error</div>
                  <div>{error}</div>
                  <Button
                    className="mt-4 bg-white text-red-500 hover:bg-gray-100"
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
