import { v4 as uuidv4 } from "uuid";

/**
 * Configuration for audio processing
 */
export interface AudioConfig {
  // Basic audio settings
  audioBitsPerSecond: number;
  mimeType: string;

  // Streaming chunk settings
  chunkDuration: number;
  minChunkSize: number;

  // Session management
  sessionTimeout: number;
  processingTimeout: number;

  // Voice Activity Detection
  vadEnabled: boolean;
  vadSensitivity: number;
  vadThreshold: number;
  vadSilenceTimeout: number;
  vadFrequencyRange: [number, number];
  vadCheckInterval: number;
}

/**
 * Default configuration for audio processing
 */
export const DEFAULT_AUDIO_CONFIG: AudioConfig = {
  // Basic audio settings
  audioBitsPerSecond: 24000,
  mimeType: "audio/webm", // Changed from MP3 to WebM which is more widely supported

  // Streaming chunk settings
  chunkDuration: 250,
  minChunkSize: 800,

  // Session management
  sessionTimeout: 5 * 60 * 1000, // 5 minutes
  processingTimeout: 2000,

  // Voice Activity Detection
  vadEnabled: false,
  vadSensitivity: 0.7,
  vadThreshold: -45,
  vadSilenceTimeout: 300,
  vadFrequencyRange: [85, 255],
  vadCheckInterval: 50,
};

/**
 * Session information for associating audio chunks
 */
export interface SessionInfo {
  sessionId: string;
  createdAt: number;
  lastUpdated: number;
  chunkSequence: number;
}

/**
 * Result from processing an audio chunk
 */
export interface ChunkProcessingResult {
  text: string;
  combinedText?: string;
  isPartial: boolean;
  chunkSequence: number;
  sessionId: string;
  metrics?: Record<string, number>;
  error?: string;
}

/**
 * Voice Activity Detection controller interface
 */
export interface VADController {
  setOnSpeechStart(callback: (data?: any) => void): void;
  setOnSpeechEnd(
    callback: (data?: { duration: number; isSpeechDetected: boolean }) => void
  ): void;
  setOnAudioLevel(callback: (level: number) => void): void;
  stop(): void;
}

/**
 * AudioService combines functionality from streamingAudio.ts and audio-recorder.ts
 * into a unified service for all audio processing needs
 */
export class AudioService {
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private audioStream: MediaStream | null = null;
  private vadController: VADController | null = null;
  private config: AudioConfig;
  private currentSession: SessionInfo | null = null;

  // Event callbacks
  private onDataAvailable?: (blob: Blob) => void;
  private onStart?: () => void;
  private onStop?: () => void;
  private onError?: (error: Error) => void;
  private onSpeechStart?: () => void;
  private onSpeechEnd?: (data: {
    duration: number;
    isSpeechDetected: boolean;
  }) => void;
  private onAudioLevel?: (level: number) => void;

  constructor(
    config?: Partial<AudioConfig>,
    callbacks?: {
      onDataAvailable?: (blob: Blob) => void;
      onStart?: () => void;
      onStop?: () => void;
      onError?: (error: Error) => void;
      onSpeechStart?: () => void;
      onSpeechEnd?: (data: {
        duration: number;
        isSpeechDetected: boolean;
      }) => void;
      onAudioLevel?: (level: number) => void;
    }
  ) {
    // Merge provided config with defaults
    this.config = { ...DEFAULT_AUDIO_CONFIG, ...config };

    // Set up callbacks
    this.onDataAvailable = callbacks?.onDataAvailable;
    this.onStart = callbacks?.onStart;
    this.onStop = callbacks?.onStop;
    this.onError = callbacks?.onError;
    this.onSpeechStart = callbacks?.onSpeechStart;
    this.onSpeechEnd = callbacks?.onSpeechEnd;
    this.onAudioLevel = callbacks?.onAudioLevel;
  }

  /**
   * Create and initialize a new streaming session
   */
  public createSession(): SessionInfo {
    this.currentSession = {
      sessionId: uuidv4(),
      createdAt: Date.now(),
      lastUpdated: Date.now(),
      chunkSequence: 0,
    };
    return this.currentSession;
  }

  /**
   * Gets the current session or creates a new one if none exists
   */
  public getSession(): SessionInfo {
    if (!this.currentSession) {
      return this.createSession();
    }
    return this.currentSession;
  }

  /**
   * Get the best supported MIME type for audio recording
   * Using the same priority as the tested InteractiveAvatar implementation
   * @returns A MIME type supported by the browser's MediaRecorder
   */
  private getSupportedMimeType(): string {
    // Optimal formats in order of preference - matching InteractiveAvatar.tsx
    const mimeTypes = [
      // Note: We try MP3 first because it's best for Azure, but we'll fall back to WebM which is widely supported
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

    // Fallback to default if none are supported - use WebM as fallback instead of empty string
    console.warn(
      "None of the preferred MIME types are supported, using default WebM"
    );
    return "audio/webm"; // Default to WebM as it's widely supported
  }

  /**
   * Start recording audio with optional streaming
   */
  public async startRecording(stream?: MediaStream): Promise<void> {
    try {
      // Reset chunks
      this.audioChunks = [];

      // Get microphone access if not provided
      if (!stream) {
        this.audioStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            sampleRate: 16000,
            sampleSize: 16,
            volume: 1.0,
          },
        });
      } else {
        this.audioStream = stream;
      }

      // Initialize voice activity detection if enabled
      if (this.config.vadEnabled) {
        this.initializeVAD(this.audioStream);
      }

      // Get a supported MIME type
      const supportedMimeType = this.getSupportedMimeType();

      // Create MediaRecorder with supported options
      const options: MediaRecorderOptions = {
        audioBitsPerSecond: this.config.audioBitsPerSecond,
      };

      // Only set mimeType if we found a supported one
      if (supportedMimeType) {
        options.mimeType = supportedMimeType;
      }

      // Create MediaRecorder with error handling
      try {
        this.mediaRecorder = new MediaRecorder(this.audioStream, options);
        console.log(
          `MediaRecorder created with mimeType: ${this.mediaRecorder.mimeType}`
        );
      } catch (e) {
        console.warn(
          "MediaRecorder not supported with these options, falling back to default",
          e
        );
        // Create with no options as fallback
        this.mediaRecorder = new MediaRecorder(this.audioStream);
        console.log(
          `Fallback MediaRecorder created with mimeType: ${this.mediaRecorder.mimeType}`
        );
      }

      // Set up event handlers
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
          this.onDataAvailable?.(event.data);
        }
      };

      this.mediaRecorder.onstart = () => {
        this.onStart?.();
      };

      this.mediaRecorder.onstop = () => {
        this.onStop?.();
      };

      this.mediaRecorder.onerror = (event) => {
        this.onError?.(new Error("MediaRecorder error: " + event.error));
      };

      // Start recording with configured chunk duration
      this.mediaRecorder.start(this.config.chunkDuration);
      console.log(
        `MediaRecorder started with ${this.config.chunkDuration}ms timeslice`
      );

      // Create a new session if none exists
      if (!this.currentSession) {
        this.createSession();
      }
    } catch (error) {
      const err =
        error instanceof Error ? error : new Error("Failed to start recording");
      this.onError?.(err);
      throw err;
    }
  }

  /**
   * Stop recording and get the complete audio blob
   */
  public async stopRecording(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder) {
        reject(new Error("No recording in progress"));
        return;
      }

      // Add a one-time event listener for the stop event
      this.mediaRecorder.addEventListener(
        "stop",
        () => {
          try {
            // Combine all chunks into a single blob
            const audioBlob = new Blob(this.audioChunks, {
              type: this.mediaRecorder?.mimeType || this.config.mimeType,
            });

            // Clean up if we're done with this session
            this.cleanup();

            resolve(audioBlob);
          } catch (error) {
            reject(error);
          }
        },
        { once: true }
      );

      // Stop recording
      this.mediaRecorder.stop();
    });
  }

  /**
   * Initialize Voice Activity Detection
   */
  private initializeVAD(stream: MediaStream): void {
    // Create audio context and nodes
    const audioContext = new (window.AudioContext ||
      (window as any).webkitAudioContext)();
    const analyser = audioContext.createAnalyser();
    const microphone = audioContext.createMediaStreamSource(stream);

    // Connect the microphone to the analyser
    microphone.connect(analyser);

    // Configure analyser
    analyser.fftSize = 1024;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    // State variables
    let silenceStart = performance.now();
    let speechStart = performance.now();
    let isSpeaking = false;

    // Function to analyze audio and detect speech
    const checkAudioLevel = () => {
      // Get frequency data
      analyser.getByteFrequencyData(dataArray);

      // Calculate volume in target frequency range
      let sum = 0;
      let count = 0;

      for (let i = 0; i < bufferLength; i++) {
        // Calculate the frequency this bin represents
        const frequency = (i * audioContext.sampleRate) / analyser.fftSize;

        // Only analyze frequencies in our target range
        if (
          frequency >= this.config.vadFrequencyRange[0] &&
          frequency <= this.config.vadFrequencyRange[1]
        ) {
          sum += dataArray[i];
          count++;
        }
      }

      // Calculate average volume
      const average = count > 0 ? sum / count : 0;

      // Normalize to 0-1 range
      const normalizedVolume = average / 255;

      // Convert to decibels (avoid log of 0)
      const dB =
        normalizedVolume > 0 ? 20 * Math.log10(normalizedVolume) : -100;

      // Report audio level for visualizations
      this.onAudioLevel?.(normalizedVolume);

      // Detect speech vs silence
      if (dB > this.config.vadThreshold) {
        // We detected speech
        if (!isSpeaking) {
          isSpeaking = true;
          speechStart = performance.now();
          this.onSpeechStart?.();
        }
        // Reset silence timer
        silenceStart = performance.now();
      } else if (
        isSpeaking &&
        performance.now() - silenceStart > this.config.vadSilenceTimeout
      ) {
        // We detected silence for long enough after speech
        const speechDuration = performance.now() - speechStart;
        isSpeaking = false;
        this.onSpeechEnd?.({
          duration: speechDuration,
          // Only consider it real speech if it was longer than a brief noise
          isSpeechDetected: speechDuration > 250,
        });
      }
    };

    // Set up periodic checking
    const intervalId = setInterval(
      checkAudioLevel,
      this.config.vadCheckInterval
    );

    // Create controller
    this.vadController = {
      setOnSpeechStart: (callback) => {
        this.onSpeechStart = callback;
      },
      setOnSpeechEnd: (callback) => {
        this.onSpeechEnd = callback;
      },
      setOnAudioLevel: (callback) => {
        this.onAudioLevel = callback;
      },
      stop: () => {
        clearInterval(intervalId);
        microphone.disconnect();
        try {
          audioContext.close();
        } catch (e) {
          console.warn("Error closing audio context:", e);
        }
      },
    };
  }

  /**
   * Optimize audio format for faster processing
   * Uses different strategies based on whether this is a final chunk
   */
  private async optimizeAudioFormat(
    audioBlob: Blob,
    isLastChunk: boolean
  ): Promise<Blob> {
    // For very small blobs, just return as is
    if (audioBlob.size < 3000) {
      return audioBlob;
    }

    try {
      // Always convert webm with opus codec to MP3 as Azure has issues with it
      if (audioBlob.type.includes("webm;codecs=opus")) {
        console.log(
          "Converting webm;codecs=opus to MP3 for better Azure compatibility"
        );
        const arrayBuffer = await audioBlob.arrayBuffer();
        return new Blob([arrayBuffer], { type: "audio/mpeg" });
      }

      // For all other types, just return the original blob to minimize processing time
      return audioBlob;
    } catch (error) {
      console.error("Error optimizing audio format:", error);
      // Return original on error
      return audioBlob;
    }
  }

  /**
   * Prepare form data for sending an audio chunk to the API with optimizations
   */
  public async prepareChunkFormData(
    audioBlob: Blob,
    isLastChunk: boolean = false
  ): Promise<FormData> {
    if (!this.currentSession) {
      throw new Error("No active session");
    }

    const startTime = performance.now();

    try {
      // Optimize audio format (without parallel operations)
      const optimizedBlob = await this.optimizeAudioFormat(
        audioBlob,
        isLastChunk
      );

      const formData = new FormData();

      // Add the audio file with appropriate extension
      formData.append(
        "file",
        optimizedBlob,
        `audio.${this.getExtensionFromMimeType(optimizedBlob.type)}`
      );

      // Add session info
      formData.append("sessionId", this.currentSession.sessionId);
      formData.append(
        "chunkSequence",
        this.currentSession.chunkSequence.toString()
      );
      formData.append("isLastChunk", isLastChunk.toString());

      // Increment chunk sequence for next time
      this.currentSession.chunkSequence++;
      this.currentSession.lastUpdated = Date.now();

      console.log(
        `FormData prepared for chunk ${this.currentSession.chunkSequence - 1}, optimized from ${audioBlob.size} to ${optimizedBlob.size} bytes in ${(performance.now() - startTime).toFixed(2)}ms`
      );

      return formData;
    } catch (error) {
      console.error("Error preparing form data:", error);

      // Fallback to basic form preparation
      const formData = new FormData();
      formData.append(
        "file",
        audioBlob,
        `audio.${this.getExtensionFromMimeType(audioBlob.type)}`
      );

      formData.append("sessionId", this.currentSession.sessionId);
      formData.append(
        "chunkSequence",
        this.currentSession.chunkSequence.toString()
      );
      formData.append("isLastChunk", isLastChunk.toString());

      // Still increment chunk sequence
      this.currentSession.chunkSequence++;
      this.currentSession.lastUpdated = Date.now();

      return formData;
    }
  }

  /**
   * Get the file extension from a MIME type
   */
  private getExtensionFromMimeType(mimeType: string): string {
    // Strip codec information if present
    const baseMimeType = mimeType.includes(";")
      ? mimeType.split(";")[0]
      : mimeType;

    if (baseMimeType.includes("webm")) return "webm";
    if (baseMimeType.includes("wav")) return "wav";
    if (baseMimeType.includes("mp3") || baseMimeType.includes("mpeg"))
      return "mp3";
    if (baseMimeType.includes("ogg")) return "ogg";
    if (baseMimeType.includes("mp4")) return "mp4";
    if (baseMimeType.includes("m4a")) return "m4a";

    // Default to mp3 as it's a common format
    console.log(`Unknown MIME type: ${mimeType}, defaulting to mp3`);
    return "mp3";
  }

  /**
   * Check if a chunk is large enough to process
   */
  public isChunkProcessable(chunk: Blob): boolean {
    return chunk.size >= this.config.minChunkSize;
  }

  /**
   * Batch multiple small chunks for more efficient processing
   */
  public batchChunks(chunks: Blob[]): Blob {
    if (chunks.length === 0) {
      return new Blob([], { type: this.config.mimeType });
    }

    if (chunks.length === 1) {
      return chunks[0];
    }

    return new Blob(chunks, { type: chunks[0].type });
  }

  /**
   * Check if we're currently recording
   */
  public isRecording(): boolean {
    return this.mediaRecorder?.state === "recording";
  }

  /**
   * Check if text is complete enough to warrant sending to AI
   */
  public shouldProcessWithAI(text: string): boolean {
    // Check for sentence endings or clear pauses
    if (text.length < 2) return false;

    // Process if there's a sentence ending
    if (text.match(/[.!?]$/)) return true;

    // Process if it's a question (even without punctuation)
    if (
      text
        .toLowerCase()
        .match(
          /^(who|what|when|where|why|how|is|are|can|could|would|will|should)/
        )
    ) {
      return text.length > 10;
    }

    // Process if long enough to likely be a complete thought
    return text.length > 20;
  }

  /**
   * Detect silence in an audio blob (after recording)
   */
  public async detectSilence(
    audioBlob: Blob,
    threshold = this.config.vadThreshold,
    windowSize = 1024
  ): Promise<{ isSilent: boolean; avgDecibels: number }> {
    return new Promise((resolve, reject) => {
      const audioContext = new (window.AudioContext ||
        (window as any).webkitAudioContext)();
      const fileReader = new FileReader();

      fileReader.onload = async (e) => {
        try {
          const arrayBuffer = e.target?.result as ArrayBuffer;
          const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

          const channelData = audioBuffer.getChannelData(0); // Get mono channel
          let sum = 0;
          let samples = 0;

          // Process in windows for efficiency
          for (let i = 0; i < channelData.length; i += windowSize) {
            let windowSum = 0;
            const limit = Math.min(i + windowSize, channelData.length);

            for (let j = i; j < limit; j++) {
              windowSum += Math.abs(channelData[j]);
            }

            const windowRMS = Math.sqrt(windowSum / (limit - i));
            sum += windowRMS;
            samples++;
          }

          const avgRMS = sum / samples;
          // Convert to dB, with safety for zero values
          const avgDecibels = avgRMS > 0 ? 20 * Math.log10(avgRMS) : -100;

          audioContext.close();
          resolve({
            isSilent: avgDecibels < threshold,
            avgDecibels,
          });
        } catch (error) {
          audioContext.close();
          reject(error);
        }
      };

      fileReader.onerror = reject;
      fileReader.readAsArrayBuffer(audioBlob);
    });
  }

  /**
   * Clean up resources
   */
  public cleanup(): void {
    // Stop VAD if running
    if (this.vadController) {
      this.vadController.stop();
      this.vadController = null;
    }

    // Stop MediaRecorder and tracks
    if (this.mediaRecorder) {
      if (this.mediaRecorder.state === "recording") {
        this.mediaRecorder.stop();
      }

      this.mediaRecorder.stream.getTracks().forEach((track) => track.stop());
      this.mediaRecorder = null;
    }

    // Clean up stream if we created it
    if (this.audioStream) {
      this.audioStream.getTracks().forEach((track) => track.stop());
      this.audioStream = null;
    }

    // Clear chunks
    this.audioChunks = [];
  }

  /**
   * Check if VAD is supported in this browser
   */
  public static isVADSupported(): boolean {
    return !!(window.AudioContext || (window as any).webkitAudioContext);
  }
}
