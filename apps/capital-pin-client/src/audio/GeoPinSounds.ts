type ToneOptions = {
  frequency: number;
  endFrequency?: number;
  duration: number;
  volume: number;
  delay?: number;
  type?: OscillatorType;
  attack?: number;
  filterFrequency?: number;
};

type NoiseOptions = {
  duration: number;
  volume: number;
  delay?: number;
  filterType?: BiquadFilterType;
  frequency?: number;
  endFrequency?: number;
  q?: number;
};

const SILENCE = 0.0001;

export class GeoPinSounds {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  /**
   * Must be called from a user interaction, such as pointerdown or click.
   */
  async initialise(): Promise<void> {
    // Web Audio is not available in every environment (e.g. jsdom tests).
    if (typeof AudioContext === "undefined") return;

    if (!this.context) {
      this.context = new AudioContext();

      this.master = this.context.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.context.destination);

      this.noiseBuffer = this.createNoiseBuffer(this.context);
    }

    if (this.context.state === "suspended") {
      try {
        await this.context.resume();
      } catch {
        // Browsers can block resume outside a user gesture; stay silent then.
      }
    }
  }

  setVolume(volume: number): void {
    if (!this.master) return;

    this.master.gain.value = Math.max(0, Math.min(1, volume));
  }

  private createNoiseBuffer(context: AudioContext): AudioBuffer {
    const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate);

    const samples = buffer.getChannelData(0);

    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = Math.random() * 2 - 1;
    }

    return buffer;
  }

  private tone(options: ToneOptions): void {
    if (!this.context || !this.master) return;

    const {
      frequency,
      endFrequency = frequency,
      duration,
      volume,
      delay = 0,
      type = "sine",
      attack = 0.005,
      filterFrequency = 12_000,
    } = options;

    const context = this.context;
    const start = context.currentTime + delay;
    const end = start + duration;

    const oscillator = context.createOscillator();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(Math.max(1, frequency), start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), end);

    filter.type = "lowpass";
    filter.frequency.value = filterFrequency;

    gain.gain.setValueAtTime(SILENCE, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(SILENCE, volume), start + attack);
    gain.gain.exponentialRampToValueAtTime(SILENCE, end);

    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);

    oscillator.start(start);
    oscillator.stop(end + 0.02);
  }

  private noise(options: NoiseOptions): void {
    if (!this.context || !this.master || !this.noiseBuffer) return;

    const {
      duration,
      volume,
      delay = 0,
      filterType = "bandpass",
      frequency = 1_000,
      endFrequency = frequency,
      q = 1,
    } = options;

    const context = this.context;
    const start = context.currentTime + delay;
    const end = start + duration;

    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();

    source.buffer = this.noiseBuffer;

    filter.type = filterType;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(Math.max(1, frequency), start);
    filter.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), end);

    gain.gain.setValueAtTime(SILENCE, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(SILENCE, volume), start + 0.003);
    gain.gain.exponentialRampToValueAtTime(SILENCE, end);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);

    source.start(start);
    source.stop(end + 0.02);
  }

  /**
   * 1. Pin pickup: small suction/pluck.
   */
  pinPickup(): void {
    this.tone({
      frequency: 680,
      endFrequency: 420,
      duration: 0.065,
      volume: 0.12,
      type: "triangle",
    });

    this.noise({
      frequency: 2_500,
      duration: 0.025,
      volume: 0.025,
      filterType: "highpass",
    });
  }

  /**
   * 2. Pin movement/hop: quiet, slightly varied tick.
   */
  pinMove(): void {
    const randomSemitones = Math.random() * 4 - 2;
    const pitchMultiplier = 2 ** (randomSemitones / 12);

    this.tone({
      frequency: 390 * pitchMultiplier,
      endFrequency: 310 * pitchMultiplier,
      duration: 0.04,
      volume: 0.045,
      type: "triangle",
      filterFrequency: 2_000,
    });

    this.noise({
      frequency: 1_200,
      duration: 0.018,
      volume: 0.012,
      q: 2,
    });
  }

  /**
   * 3. Pin drop: firm magnetic snap.
   */
  pinDrop(): void {
    this.tone({
      frequency: 190,
      endFrequency: 85,
      duration: 0.12,
      volume: 0.16,
      type: "sine",
      filterFrequency: 1_200,
    });

    this.tone({
      frequency: 720,
      endFrequency: 280,
      duration: 0.055,
      volume: 0.07,
      type: "triangle",
    });

    this.noise({
      frequency: 1_100,
      endFrequency: 550,
      duration: 0.045,
      volume: 0.055,
      q: 2.5,
    });
  }

  /**
   * 4. Guess locked: ascending confirmation.
   */
  guessConfirmed(): void {
    this.tone({
      frequency: 523.25,
      duration: 0.11,
      volume: 0.1,
      type: "sine",
    });

    this.tone({
      frequency: 783.99,
      duration: 0.16,
      volume: 0.12,
      delay: 0.075,
      type: "sine",
    });
  }

  /**
   * 5. Guess unlocked or cancelled: descending confirmation.
   */
  guessUnlocked(): void {
    this.tone({
      frequency: 659.25,
      duration: 0.1,
      volume: 0.08,
      type: "sine",
    });

    this.tone({
      frequency: 392,
      duration: 0.14,
      volume: 0.07,
      delay: 0.07,
      type: "sine",
    });
  }

  /**
   * 6. Correct location reveal: sonar/radar pulse.
   */
  answerReveal(): void {
    this.tone({
      frequency: 920,
      endFrequency: 820,
      duration: 0.2,
      volume: 0.14,
      type: "sine",
      attack: 0.002,
    });

    // Quieter echo.
    this.tone({
      frequency: 820,
      endFrequency: 760,
      duration: 0.23,
      volume: 0.055,
      delay: 0.16,
      type: "sine",
    });

    this.tone({
      frequency: 210,
      endFrequency: 150,
      duration: 0.3,
      volume: 0.045,
      type: "sine",
    });
  }

  /**
   * 7. Line animation between guess and correct location.
   *
   * progressDistance should be between 0 and 1.
   */
  connectionWhoosh(progressDistance = 0.5): void {
    const distance = Math.max(0, Math.min(1, progressDistance));
    const duration = 0.18 + distance * 0.42;

    this.noise({
      frequency: 300,
      endFrequency: 2_400,
      duration,
      volume: 0.075,
      filterType: "bandpass",
      q: 1.3,
    });

    this.tone({
      frequency: 160,
      endFrequency: 360,
      duration,
      volume: 0.025,
      type: "sine",
    });
  }

  /**
   * 8. Very close guess: bright sparkle.
   */
  closeGuess(): void {
    this.tone({
      frequency: 880,
      duration: 0.16,
      volume: 0.1,
      type: "sine",
    });

    this.tone({
      frequency: 1_108.73,
      duration: 0.18,
      volume: 0.085,
      delay: 0.055,
      type: "sine",
    });

    this.tone({
      frequency: 1_318.51,
      duration: 0.24,
      volume: 0.075,
      delay: 0.11,
      type: "sine",
    });

    this.noise({
      frequency: 4_500,
      duration: 0.08,
      volume: 0.018,
      delay: 0.1,
      filterType: "highpass",
    });
  }

  /**
   * 9. Medium guess: neutral result.
   */
  mediumGuess(): void {
    this.tone({
      frequency: 392,
      duration: 0.13,
      volume: 0.085,
      type: "triangle",
    });

    this.tone({
      frequency: 523.25,
      duration: 0.16,
      volume: 0.075,
      delay: 0.085,
      type: "triangle",
    });
  }

  /**
   * 10. Far guess: low, non-aggressive result.
   */
  farGuess(): void {
    this.tone({
      frequency: 210,
      endFrequency: 125,
      duration: 0.28,
      volume: 0.11,
      type: "sine",
      filterFrequency: 900,
    });

    this.noise({
      frequency: 380,
      endFrequency: 180,
      duration: 0.13,
      volume: 0.025,
      filterType: "lowpass",
    });
  }

  /**
   * 11. Round winner: short victory flourish.
   */
  roundWin(): void {
    const notes = [
      { frequency: 523.25, delay: 0 },
      { frequency: 659.25, delay: 0.075 },
      { frequency: 783.99, delay: 0.15 },
      { frequency: 1_046.5, delay: 0.25 },
    ];

    for (const note of notes) {
      this.tone({
        frequency: note.frequency,
        duration: note.delay === 0.25 ? 0.35 : 0.16,
        volume: note.delay === 0.25 ? 0.13 : 0.09,
        delay: note.delay,
        type: "triangle",
      });
    }
  }

  /**
   * 12. One dynamic sound based on score.
   *
   * accuracy:
   * 0 = worst possible guess
   * 1 = perfect guess
   */
  scoreResult(accuracy: number): void {
    const value = Math.max(0, Math.min(1, accuracy));

    const frequency = 170 + value ** 1.4 * 850;
    const duration = 0.15 + value * 0.18;
    const brightness = 900 + value * 8_000;

    this.tone({
      frequency,
      endFrequency: frequency * (0.9 + value * 0.2),
      duration,
      volume: 0.09 + value * 0.04,
      type: value > 0.65 ? "triangle" : "sine",
      filterFrequency: brightness,
    });

    if (value > 0.75) {
      this.tone({
        frequency: frequency * 1.5,
        duration: duration * 0.8,
        volume: 0.045,
        delay: 0.06,
        type: "sine",
      });
    }

    if (value > 0.95) {
      this.noise({
        frequency: 5_000,
        duration: 0.1,
        volume: 0.02,
        delay: 0.08,
        filterType: "highpass",
      });
    }
  }
}

export const geoPinSounds = new GeoPinSounds();
