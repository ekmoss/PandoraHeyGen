/**
 * Handles audio recording functionality for voice input
 */
export class AudioRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private onDataAvailable?: (blob: Blob) => void;
  private onStart?: () => void;
  private onStop?: () => void;
  private onError?: (error: Error) => void;

  constructor(options?: {
    onDataAvailable?: (blob: Blob) => void;
    onStart?: () => void;
    onStop?: () => void;
    onError?: (error: Error) => void;
  }) {
    this.onDataAvailable = options?.onDataAvailable;
    this.onStart = options?.onStart;
    this.onStop = options?.onStop;
    this.onError = options?.onError;
  }

  /**
   * Start recording audio
   */
  async startRecording(): Promise<void> {
    try {
      // Reset chunks
      this.audioChunks = [];

      // Get microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          sampleSize: 16,
          volume: 1.0,
        },
      });

      // Create MediaRecorder
      this.mediaRecorder = new MediaRecorder(stream, {
        mimeType: "audio/webm",
      });

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

      // Start recording
      this.mediaRecorder.start(100); // Collect data in 100ms chunks
    } catch (error) {
      const err =
        error instanceof Error ? error : new Error("Failed to start recording");
      this.onError?.(err);
      throw err;
    }
  }

  /**
   * Stop recording and get the audio blob
   */
  async stopRecording(): Promise<Blob> {
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
              type: "audio/webm",
            });

            // Stop all tracks
            this.mediaRecorder?.stream
              .getTracks()
              .forEach((track) => track.stop());

            // Clear the recorder
            this.mediaRecorder = null;
            this.audioChunks = [];

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
   * Check if currently recording
   */
  isRecording(): boolean {
    return this.mediaRecorder?.state === "recording";
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    if (this.mediaRecorder) {
      if (this.mediaRecorder.state === "recording") {
        this.mediaRecorder.stop();
      }
      this.mediaRecorder.stream.getTracks().forEach((track) => track.stop());
      this.mediaRecorder = null;
    }
    this.audioChunks = [];
  }
}
