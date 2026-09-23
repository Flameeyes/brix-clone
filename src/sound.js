// @ts-check

/**
 * PC-speaker style beeps: a single square wave whose pitch follows a list of
 * frequencies, each held for `step` seconds.
 */
export class Sound {
  constructor() {
    this.enabled = true;
    /** @type {AudioContext | null} */
    this.audio = null;
  }

  /** Browsers only allow audio after a user gesture, so call this from one. */
  unlock() {
    if (!this.audio) {
      this.audio = new AudioContext();
    }
    if (this.audio.state === 'suspended') {
      void this.audio.resume();
    }
  }

  toggle() {
    this.enabled = !this.enabled;
  }

  /** @param {number[]} frequencies @param {number} step */
  play(frequencies, step) {
    const audio = this.audio;
    if (!this.enabled || !audio || audio.state !== 'running') {
      return;
    }
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = 'square';
    gain.gain.value = 0.06;
    const start = audio.currentTime;
    frequencies.forEach((frequency, i) => oscillator.frequency.setValueAtTime(frequency, start + i * step));
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(start);
    oscillator.stop(start + frequencies.length * step);
  }

  move() {
    this.play([220], 0.02);
  }

  grab() {
    this.play([660, 880], 0.02);
  }

  land() {
    this.play([110], 0.03);
  }

  /** @param {number} size */
  blast(size) {
    const sweep = Array.from({ length: 10 + size * 2 }, (_, i) => 1400 - i * 90 + (i % 2) * 300);
    this.play(sweep, 0.015);
  }

  tick() {
    this.play([1200], 0.015);
  }

  solved() {
    this.play([523, 659, 784, 1047, 784, 1047], 0.08);
  }

  bonus() {
    this.play([1800], 0.01);
  }

  fail() {
    this.play([392, 370, 349, 330, 311, 294, 277, 262], 0.09);
  }
}
