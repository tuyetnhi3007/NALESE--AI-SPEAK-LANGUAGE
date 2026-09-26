// ============================================================
// lib/audio-utils.ts — Client-side Web Audio API utilities
// Handles recording, visualization, and audio playback.
// ============================================================

/**
 * Checks if the browser supports the required audio APIs.
 */
export function checkAudioSupport(): { supported: boolean; reason?: string } {
  if (typeof window === 'undefined') return { supported: false, reason: 'Server environment' };
  if (!navigator.mediaDevices?.getUserMedia) {
    return { supported: false, reason: 'getUserMedia not supported in this browser.' };
  }
  if (!window.MediaRecorder) {
    return { supported: false, reason: 'MediaRecorder not supported in this browser.' };
  }
  return { supported: true };
}

/**
 * Returns the best supported MIME type for audio recording.
 * Prefers webm/opus for smallest file size and best Whisper compatibility.
 */
export function getBestAudioMimeType(): string {
  const types = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ];
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return 'audio/webm'; // Fallback
}

/**
 * Requests microphone access and returns a MediaStream.
 * Configured for optimal speech recognition:
 * - echoCancellation: removes echo from speakers
 * - noiseSuppression: filters background noise
 * - sampleRate: 16kHz is optimal for Whisper
 */
export async function requestMicrophoneAccess(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      sampleRate: 16000,
      channelCount: 1, // Mono for smaller files
    },
  });
}

/**
 * Converts an audio Blob to a base64 string for API transmission.
 */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      // Strip the data URL prefix (e.g., "data:audio/webm;base64,")
      resolve(result.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Converts a base64 audio string back to a playable Blob.
 */
export function base64ToBlob(base64: string, mimeType = 'audio/mpeg'): Blob {
  const byteCharacters = atob(base64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mimeType });
}

/**
 * Plays a base64-encoded MP3 audio string.
 * Returns the HTMLAudioElement so callers can listen to 'ended' events.
 */
export function playBase64Audio(base64: string, speed = 1.0): HTMLAudioElement {
  const blob = base64ToBlob(base64, 'audio/mpeg');
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.playbackRate = speed;
  audio.onended = () => URL.revokeObjectURL(url); // Clean up memory
  audio.play();
  return audio;
}

/**
 * Creates an AudioContext analyzer for real-time frequency visualization.
 * Returns the analyser node and a cleanup function.
 */
export function createAudioAnalyzer(stream: MediaStream): {
  analyser: AnalyserNode;
  cleanup: () => void;
} {
  const audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(stream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.8;
  source.connect(analyser);

  return {
    analyser,
    cleanup: () => {
      source.disconnect();
      audioContext.close();
    },
  };
}

/**
 * Draws an audio frequency waveform on a canvas element.
 * Call this in an animation frame loop while recording.
 */
export function drawWaveform(
  canvas: HTMLCanvasElement,
  analyser: AnalyserNode,
  color = '#8b5cf6'
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  analyser.getByteFrequencyData(dataArray);

  const width = canvas.width;
  const height = canvas.height;
  const barWidth = (width / bufferLength) * 2.5;

  ctx.clearRect(0, 0, width, height);

  let x = 0;
  for (let i = 0; i < bufferLength; i++) {
    const barHeight = (dataArray[i] / 255) * height * 0.9;

    // Gradient bar
    const gradient = ctx.createLinearGradient(0, height - barHeight, 0, height);
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, 'rgba(139, 92, 246, 0.2)');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.roundRect(x, height - barHeight, barWidth - 1, barHeight, 2);
    ctx.fill();

    x += barWidth + 1;
  }
}

/**
 * Draws a static idle waveform (sinusoidal) when not recording.
 */
export function drawIdleWaveform(canvas: HTMLCanvasElement, time: number): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const width = canvas.width;
  const height = canvas.height;

  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = 'rgba(139, 92, 246, 0.3)';
  ctx.lineWidth = 2;
  ctx.beginPath();

  for (let x = 0; x < width; x++) {
    const y = height / 2 + Math.sin((x / width) * Math.PI * 4 + time * 2) * 8;
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

/**
 * Generates a unique message ID.
 */
export function generateId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
