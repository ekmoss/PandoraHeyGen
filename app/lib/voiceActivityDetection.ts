/**
 * Voice Activity Detection (VAD) implementation using WebAudio API
 *
 * This module provides real-time speech detection capabilities to improve
 * the latency of audio processing by detecting when a user starts and stops speaking.
 */

interface VADOptions {
  /** dB threshold for speech detection (lower value = more sensitive) */
  threshold: number;
  /** ms of silence to consider speech ended */
  silenceTimeout: number;
  /** Hz range to analyze (human speech roughly 85-255 Hz) */
  frequencyRange: [number, number];
  /** How often to check audio levels (ms) */
  checkInterval: number;
}

interface VADController {
  /** Set callback for when speech starts */
  setOnSpeechStart(callback: (data?: any) => void): void;
  /** Set callback for when speech ends */
  setOnSpeechEnd(
    callback: (data?: { duration: number; isSpeechDetected: boolean }) => void
  ): void;
  /** Set callback for audio level updates (for visualizations) */
  setOnAudioLevel(callback: (level: number) => void): void;
  /** Stop the VAD and clean up resources */
  stop(): void;
}

// Default options optimized for human speech detection
const DEFAULT_VAD_OPTIONS: VADOptions = {
  threshold: -45, // dB threshold (lower = more sensitive)
  silenceTimeout: 300, // ms of silence to consider speech ended
  frequencyRange: [85, 255], // Hz range to analyze (human speech)
  checkInterval: 50, // Check every 50ms
};

/**
 * Create a Voice Activity Detector for a given audio stream
 */
export function createVAD(
  stream: MediaStream,
  options: Partial<VADOptions> = {}
): VADController {
  // Create audio context and nodes
  const audioContext = new (window.AudioContext ||
    (window as any).webkitAudioContext)();
  const analyser = audioContext.createAnalyser();
  const microphone = audioContext.createMediaStreamSource(stream);

  // Connect the microphone to the analyser
  microphone.connect(analyser);

  // Merge provided options with defaults
  const vadOptions: VADOptions = {
    ...DEFAULT_VAD_OPTIONS,
    ...options,
  };

  // Configure analyser
  analyser.fftSize = 1024;
  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  // State variables
  let silenceStart = performance.now();
  let speechStart = performance.now();
  let isSpeaking = false;
  let onSpeechStart: ((data?: any) => void) | null = null;
  let onSpeechEnd:
    | ((data?: { duration: number; isSpeechDetected: boolean }) => void)
    | null = null;
  let onAudioLevel: ((level: number) => void) | null = null;

  // Function to analyze audio and detect speech
  function checkAudioLevel() {
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
        frequency >= vadOptions.frequencyRange[0] &&
        frequency <= vadOptions.frequencyRange[1]
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
    const dB = normalizedVolume > 0 ? 20 * Math.log10(normalizedVolume) : -100;

    // Report audio level for visualizations
    onAudioLevel?.(normalizedVolume);

    // Detect speech vs silence
    if (dB > vadOptions.threshold) {
      // We detected speech
      if (!isSpeaking) {
        isSpeaking = true;
        speechStart = performance.now();
        onSpeechStart?.();
      }
      // Reset silence timer
      silenceStart = performance.now();
    } else if (
      isSpeaking &&
      performance.now() - silenceStart > vadOptions.silenceTimeout
    ) {
      // We detected silence for long enough after speech
      const speechDuration = performance.now() - speechStart;
      isSpeaking = false;
      onSpeechEnd?.({
        duration: speechDuration,
        // Only consider it real speech if it was longer than a brief noise
        isSpeechDetected: speechDuration > 250,
      });
    }
  }

  // Set up periodic checking
  const intervalId = setInterval(checkAudioLevel, vadOptions.checkInterval);

  // Return controller object
  return {
    setOnSpeechStart(callback) {
      onSpeechStart = callback;
    },
    setOnSpeechEnd(callback) {
      onSpeechEnd = callback;
    },
    setOnAudioLevel(callback) {
      onAudioLevel = callback;
    },
    stop() {
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
 * Check if the browser supports the WebAudio API features needed for VAD
 */
export function isVADSupported(): boolean {
  return !!(window.AudioContext || (window as any).webkitAudioContext);
}

/**
 * Helper to detect silence in an audio blob
 * This is useful for checking recorded audio after the fact
 */
export async function detectSilence(
  audioBlob: Blob,
  threshold = -50,
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
