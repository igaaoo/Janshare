// Toca o PCM s16le estéreo vindo do capturador nativo (lib/audio.ts).
// Fila com pré-buffer para absorver o jitter e teto para não acumular atraso.
const PREBUFFER = 0.06 * sampleRate;
const MAX_BUFFER = 0.2 * sampleRate;

class PcmPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.capacity = Math.ceil(sampleRate); // 1 s por canal
    this.left = new Float32Array(this.capacity);
    this.right = new Float32Array(this.capacity);
    this.read = 0;
    this.size = 0;
    this.primed = false;
    this.port.onmessage = event => this.push(new Int16Array(event.data));
  }

  push(samples) {
    const frames = samples.length >> 1;
    for (let i = 0; i < frames; i++) {
      const write = (this.read + this.size) % this.capacity;
      this.left[write] = samples[2 * i] / 32768;
      this.right[write] = samples[2 * i + 1] / 32768;
      if (this.size < this.capacity) this.size++;
      else this.read = (this.read + 1) % this.capacity;
    }
    if (this.size > MAX_BUFFER) {
      const drop = this.size - PREBUFFER;
      this.read = (this.read + drop) % this.capacity;
      this.size -= drop;
    }
  }

  process(_inputs, outputs) {
    const [left, right] = outputs[0];
    if (!this.primed && this.size >= PREBUFFER) this.primed = true;
    if (!this.primed) return true;

    for (let i = 0; i < left.length; i++) {
      if (this.size === 0) {
        // Faltou dado: completa com silêncio e volta a esperar o pré-buffer.
        left.fill(0, i);
        right?.fill(0, i);
        this.primed = false;
        break;
      }
      left[i] = this.left[this.read];
      if (right) right[i] = this.right[this.read];
      this.read = (this.read + 1) % this.capacity;
      this.size--;
    }
    return true;
  }
}

registerProcessor("pcm-player", PcmPlayer);
