const FRAME_BYTES = 4; // s16le estéreo

export type SystemAudio = { track: MediaStreamTrack; stop(): void };

/**
 * Som do sistema sem o Discord, vindo do capturador nativo (main → "audio:chunk"),
 * convertido em uma faixa WebRTC por um AudioWorklet. Rejeita se o capturador falhar.
 */
export async function startSystemAudio(): Promise<SystemAudio> {
  await window.janshare.startAudio();

  let context: AudioContext | null = null;
  let unsubscribe = () => {};
  try {
    context = new AudioContext({ sampleRate: 48000 });
    await context.audioWorklet.addModule("./pcm-worklet.js");
    const player = new AudioWorkletNode(context, "pcm-player", { numberOfInputs: 0, outputChannelCount: [2] });
    const destination = context.createMediaStreamDestination();
    player.connect(destination);

    // Os chunks do pipe podem cortar uma amostra no meio: guarda o resto para o próximo.
    let pending = new Uint8Array(0);
    unsubscribe = window.janshare.onAudioChunk(chunk => {
      const data = new Uint8Array(pending.length + chunk.length);
      data.set(pending);
      data.set(chunk, pending.length);
      const usable = data.length - (data.length % FRAME_BYTES);
      pending = data.slice(usable);
      if (usable === 0) return;
      const frames = data.slice(0, usable).buffer;
      player.port.postMessage(frames, [frames]);
    });

    const track = destination.stream.getAudioTracks()[0];
    const ctx = context;
    let stopped = false;
    return {
      track,
      stop() {
        if (stopped) return;
        stopped = true;
        unsubscribe();
        track.stop();
        void ctx.close();
        void window.janshare.stopAudio();
      }
    };
  } catch (error) {
    unsubscribe();
    void context?.close();
    void window.janshare.stopAudio();
    throw error;
  }
}
