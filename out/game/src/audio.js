// All sound, synthesised at run time: oscillators and noise buffers through a compressor, no audio
// files and nothing fetched. The context is created on the first real gesture (browsers refuse
// audio before one), and every voice is fire-and-forget so a sound never blocks the frame.

/** The one noise buffer, generated once: white noise is the base of every impact and thruster. */
function createNoiseBuffer(context) {
  const length = Math.floor(context.sampleRate * 1.2);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let index = 0; index < length; index += 1) {
    const white = Math.random() * 2 - 1;
    // A touch of smoothing keeps the noise from sounding like static hiss.
    last = (last + white * 0.35) * 0.82;
    data[index] = last;
  }
  return buffer;
}

export function createAudio() {
  let context = null;
  let master = null;
  let noise = null;
  let muted = false;
  let ready = false;

  function build() {
    if (context !== null) return;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (Ctor === undefined) return;
    context = new Ctor();
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 24;
    compressor.ratio.value = 8;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.18;
    master = context.createGain();
    master.gain.value = muted ? 0 : 0.55;
    master.connect(compressor);
    compressor.connect(context.destination);
    noise = createNoiseBuffer(context);
  }

  /** Called from a user gesture: builds the graph, resumes it, and starts the ambient pad. */
  function unlock() {
    build();
    if (context === null) return;
    if (context.state === 'suspended') context.resume();
    if (!ready) {
      ready = true;
      startPad();
    }
  }

  function tone(options) {
    if (context === null) return;
    const start = context.currentTime + (options.delay ?? 0);
    const duration = options.duration ?? 0.12;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = options.type ?? 'square';
    oscillator.frequency.setValueAtTime(Math.max(20, options.from), start);
    if (options.to !== undefined) oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, options.to), start + duration);
    const gain = options.gain ?? 0.08;
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(gain, start + Math.min(0.012, duration * 0.4));
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(envelope);
    envelope.connect(master);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.03);
  }

  function noiseBurst(options) {
    if (context === null || noise === null) return;
    const start = context.currentTime + (options.delay ?? 0);
    const duration = options.duration ?? 0.18;
    const source = context.createBufferSource();
    source.buffer = noise;
    const filter = context.createBiquadFilter();
    filter.type = options.type ?? 'bandpass';
    filter.Q.value = options.q ?? 1.1;
    filter.frequency.setValueAtTime(options.from ?? 1800, start);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, options.to ?? 400), start + duration);
    const envelope = context.createGain();
    const gain = options.gain ?? 0.07;
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(gain, start + 0.006);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(master);
    source.start(start);
    source.stop(start + duration + 0.02);
  }

  /** A slow two-voice drone under everything: the nebula has a hum, and so does the skiff. */
  function startPad() {
    if (context === null) return;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 320;
    filter.Q.value = 4;
    const gain = context.createGain();
    gain.gain.value = 0.0;
    gain.gain.linearRampToValueAtTime(0.05, context.currentTime + 4);
    filter.connect(gain);
    gain.connect(master);
    for (const frequency of [55, 82.5, 110.3]) {
      const oscillator = context.createOscillator();
      oscillator.type = 'sawtooth';
      oscillator.frequency.value = frequency;
      oscillator.detune.value = (Math.random() - 0.5) * 14;
      oscillator.connect(filter);
      oscillator.start();
    }
    // A slow sweep of the filter gives the drone some weather without any scheduling.
    const lfo = context.createOscillator();
    const depth = context.createGain();
    lfo.frequency.value = 0.06;
    depth.gain.value = 120;
    lfo.connect(depth);
    depth.connect(filter.frequency);
    lfo.start();
  }

  const SOUNDS = {
    fire() {
      tone({ type: 'square', from: 820, to: 300, duration: 0.075, gain: 0.045 });
      noiseBurst({ type: 'highpass', from: 2400, to: 900, duration: 0.05, gain: 0.022 });
    },
    hit() {
      noiseBurst({ type: 'bandpass', from: 2200, to: 700, duration: 0.06, gain: 0.05, q: 2 });
    },
    kill() {
      tone({ type: 'sawtooth', from: 300, to: 60, duration: 0.2, gain: 0.055 });
      noiseBurst({ type: 'lowpass', from: 2600, to: 260, duration: 0.22, gain: 0.075 });
    },
    pickup() {
      tone({ type: 'sine', from: 660, to: 990, duration: 0.1, gain: 0.06 });
      tone({ type: 'sine', from: 990, to: 1480, duration: 0.11, gain: 0.045, delay: 0.06 });
    },
    dash() {
      noiseBurst({ type: 'highpass', from: 500, to: 3200, duration: 0.24, gain: 0.075 });
      tone({ type: 'sine', from: 220, to: 70, duration: 0.18, gain: 0.05 });
    },
    hull() {
      tone({ type: 'square', from: 150, to: 46, duration: 0.42, gain: 0.11 });
      noiseBurst({ type: 'lowpass', from: 900, to: 90, duration: 0.5, gain: 0.1 });
    },
    wave() {
      tone({ type: 'triangle', from: 392, to: 392, duration: 0.16, gain: 0.06 });
      tone({ type: 'triangle', from: 587, to: 587, duration: 0.2, gain: 0.055, delay: 0.13 });
    },
    boss() {
      tone({ type: 'sawtooth', from: 88, to: 44, duration: 1.2, gain: 0.09 });
      tone({ type: 'sine', from: 132, to: 66, duration: 1.0, gain: 0.07, delay: 0.1 });
      noiseBurst({ type: 'lowpass', from: 600, to: 80, duration: 1.4, gain: 0.06 });
    },
    bossShot() {
      tone({ type: 'square', from: 190, to: 80, duration: 0.16, gain: 0.045 });
    },
    phase() {
      tone({ type: 'sawtooth', from: 130, to: 90, duration: 0.5, gain: 0.07 });
      noiseBurst({ type: 'bandpass', from: 900, to: 200, duration: 0.6, gain: 0.07 });
    },
    win() {
      const notes = [523, 659, 784, 1046, 1318];
      for (let index = 0; index < notes.length; index += 1) {
        tone({ type: 'triangle', from: notes[index], to: notes[index] * 1.002, duration: 0.55, gain: 0.075, delay: index * 0.13 });
      }
    },
    lose() {
      const notes = [392, 311, 233, 155];
      for (let index = 0; index < notes.length; index += 1) {
        tone({ type: 'sawtooth', from: notes[index], to: notes[index] * 0.94, duration: 0.7, gain: 0.07, delay: index * 0.17 });
      }
      noiseBurst({ type: 'lowpass', from: 700, to: 60, duration: 1.6, gain: 0.07, delay: 0.1 });
    },
    start() {
      tone({ type: 'triangle', from: 220, to: 440, duration: 0.3, gain: 0.07 });
      tone({ type: 'triangle', from: 440, to: 880, duration: 0.35, gain: 0.05, delay: 0.15 });
    },
    ui() {
      tone({ type: 'square', from: 520, to: 520, duration: 0.05, gain: 0.03 });
    },
  };

  return {
    unlock,
    /** Play a named voice; unknown names are ignored so a typo can never break a frame. */
    play(name) {
      if (context === null || muted) return;
      const sound = SOUNDS[name];
      if (sound !== undefined) sound();
    },
    toggleMute() {
      muted = !muted;
      if (master !== null) master.gain.value = muted ? 0 : 0.55;
      return muted;
    },
    isMuted() {
      return muted;
    },
    isReady() {
      return context !== null;
    },
  };
}
