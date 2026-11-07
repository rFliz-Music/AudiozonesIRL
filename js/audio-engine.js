// audio-engine.js
// Minimal Web Audio playback: one "voice" per zone, with fades.
// Kept behind start/stop/setVolume so it can later be swapped for FMOD.

export function createAudioEngine({ resolveAudio }) {

    let ctx = null;

    const buffers = new Map();   // audio key -> Promise<AudioBuffer>
    const voices = new Map();    // voice id -> { gain, source, fadeOut }


    function audioKey(ref) {
        return ref.kind === "file" ? `file:${ref.id}` : `url:${ref.url}`;
    }


    /** Must be called from a user gesture (tap/click) on mobile. */
    function unlock() {
        // iOS 17+: play even when the ring/silent switch is on.
        if (navigator.audioSession) {
            try { navigator.audioSession.type = "playback"; } catch { /* unsupported */ }
        }

        if (!ctx) {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            ctx = new Ctx();
        }
        if (ctx.state !== "running") {
            return ctx.resume();
        }
        return Promise.resolve();
    }


    function loadBuffer(ref) {
        const key = audioKey(ref);

        if (!buffers.has(key)) {
            const promise = resolveAudio(ref)
                .then(arrayBuffer => ctx.decodeAudioData(arrayBuffer));

            promise.catch(() => buffers.delete(key));
            buffers.set(key, promise);
        }

        return buffers.get(key);
    }


    function ramp(param, to, seconds) {
        const now = ctx.currentTime;

        param.cancelScheduledValues(now);
        param.setValueAtTime(param.value, now);
        param.linearRampToValueAtTime(to, now + Math.max(seconds, 0.02));
    }


    /**
     * Starts a voice. If one already plays under this id it is left alone.
     * @param {string} id
     * @param {{audio, volume, loop, fadeIn, fadeOut}} props
     * @param {{onEnded?: () => void}} [options]
     */
    async function start(id, props, { onEnded } = {}) {

        if (!ctx || !props.audio || voices.has(id)) return;

        const gain = ctx.createGain();
        gain.gain.value = 0;
        gain.connect(ctx.destination);

        const voice = {
            gain,
            source: null,
            fadeOut: props.fadeOut ?? 2,
            audioKey: audioKey(props.audio)
        };

        voices.set(id, voice);

        let buffer;

        try {
            buffer = await loadBuffer(props.audio);
        } catch (error) {
            if (voices.get(id) === voice) voices.delete(id);
            gain.disconnect();
            throw error;
        }

        // Stopped (or replaced) while loading.
        if (voices.get(id) !== voice) {
            gain.disconnect();
            return;
        }

        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = !!props.loop;
        source.connect(gain);
        source.start();

        source.onended = () => {
            gain.disconnect();
            if (voices.get(id) === voice) {
                voices.delete(id);
                onEnded?.();
            }
        };

        voice.source = source;

        ramp(gain.gain, props.volume ?? 1, props.fadeIn ?? 0);
    }


    function stop(id, fadeOut) {

        const voice = voices.get(id);

        if (!voice) return;

        voices.delete(id);

        const seconds = Math.max(fadeOut ?? voice.fadeOut, 0.02);

        ramp(voice.gain.gain, 0, seconds);

        if (voice.source) {
            voice.source.stop(ctx.currentTime + seconds + 0.05);
        } else {
            voice.gain.disconnect();
        }
    }


    function stopAll(fadeOut) {
        [...voices.keys()].forEach(id => stop(id, fadeOut));
    }


    /** Applies live edits (volume, fades, audio swap) to a playing voice. */
    function update(id, props) {

        const voice = voices.get(id);

        if (!voice) return;

        if (!props.audio || audioKey(props.audio) !== voice.audioKey) {
            stop(id, 0.3);
            if (props.audio) start(id, props).catch(console.error);
            return;
        }

        voice.fadeOut = props.fadeOut ?? voice.fadeOut;

        if (voice.source) {
            voice.source.loop = !!props.loop;
            ramp(voice.gain.gain, props.volume ?? 1, 0.1);
        }
    }


    return {
        unlock,
        start,
        stop,
        stopAll,
        update,
        isPlaying: id => voices.has(id)
    };
}
