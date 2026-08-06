export type FeedbackKind =
  | "move"
  | "select"
  | "danger"
  | "invalid"
  | "eliminated"
  | "win"
  | "confirm";

const HAPTIC_PATTERNS: Record<FeedbackKind, number | number[]> = {
  move: 12,
  select: 8,
  danger: [30, 40, 30],
  invalid: [25, 40, 25],
  eliminated: [40, 70, 40],
  win: [20, 40, 20, 40, 60],
  confirm: [15, 40],
};

let audioContext: AudioContext | null = null;
let masterGain: GainNode | null = null;

/**
 * Creates or resumes the shared Web Audio context. Call from a user gesture
 * (pointerdown, click) so browsers allow audio on phones.
 */
export async function primeGameFeedback(): Promise<void> {
  if (typeof window === "undefined" || typeof AudioContext === "undefined") {
    return;
  }
  try {
    if (!audioContext) {
      audioContext = new AudioContext();
      masterGain = audioContext.createGain();
      masterGain.gain.value = 0.22;
      masterGain.connect(audioContext.destination);
    }
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }
  } catch {
    // Browsers can block audio outside a user gesture; stay silent then.
  }
}

function tone(
  frequency: number,
  endFrequency: number,
  duration: number,
  volume: number,
  delay = 0,
  type: OscillatorType = "sine",
): void {
  if (!audioContext || !masterGain) {
    return;
  }
  const start = audioContext.currentTime + delay;
  const end = start + duration;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(Math.max(1, frequency), start);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), end);

  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);

  oscillator.connect(gain);
  gain.connect(masterGain);
  oscillator.start(start);
  oscillator.stop(end + 0.02);
}

function playSound(kind: FeedbackKind): void {
  switch (kind) {
    case "move":
      tone(220, 180, 0.05, 0.055, 0, "triangle");
      tone(330, 260, 0.04, 0.04, 0.04, "triangle");
      break;
    case "select":
      tone(440, 440, 0.06, 0.07);
      break;
    case "danger":
      tone(540, 220, 0.2, 0.1, 0, "triangle");
      break;
    case "invalid":
      tone(180, 120, 0.14, 0.08);
      break;
    case "eliminated":
      tone(330, 120, 0.35, 0.11);
      tone(220, 90, 0.3, 0.07, 0.1);
      break;
    case "confirm":
      tone(523.25, 523.25, 0.08, 0.08);
      tone(783.99, 783.99, 0.12, 0.07, 0.07);
      break;
    case "win":
      tone(523.25, 523.25, 0.12, 0.09, 0, "triangle");
      tone(659.25, 659.25, 0.12, 0.09, 0.08, "triangle");
      tone(783.99, 783.99, 0.2, 0.1, 0.16, "triangle");
      break;
  }
}

/** Vibrates only when the browser and device support it. */
export function hapticFeedback(kind: FeedbackKind): void {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") {
    return;
  }
  try {
    navigator.vibrate(HAPTIC_PATTERNS[kind]);
  } catch {
    // Some browsers throw outside a user gesture; ignore.
  }
}

/** Plays a subtle sound and vibration for a game action or outcome. */
export function gameFeedback(kind: FeedbackKind): void {
  hapticFeedback(kind);
  void primeGameFeedback().then(() => playSound(kind));
}
