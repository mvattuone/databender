export class MockAudioNode {
    constructor(name) {
        this.name = name;
        this.connections = [];
    }

    connect(target) {
        this.connections.push(target);
        return target;
    }
}

export class MockAudioBuffer {
    constructor(numberOfChannels, length, sampleRate) {
        this.length = length;
        this.numberOfChannels = numberOfChannels;
        this.sampleRate = sampleRate;
        this.channels = Array.from(
            { length: numberOfChannels },
            () => new Float32Array(length)
        );
    }

    getChannelData(channel) {
        return this.channels[channel];
    }
}

export class MockBufferSourceNode extends MockAudioNode {
    constructor() {
        super('source');
        this.started = false;
        this.buffer = null;
    }

    start() {
        this.started = true;
    }
}

export const createAudioContext = (sampleRate = 48000) => ({
    sampleRate,
    createBuffer(numberOfChannels, length, rate) {
        return new MockAudioBuffer(numberOfChannels, length, rate);
    }
});

export const createDeferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });

    return { promise, resolve, reject };
};

export const installOfflineAudioContext = ({ startRendering } = {}) => {
    const original = globalThis.OfflineAudioContext;
    const contexts = [];

    class MockOfflineAudioContext {
        constructor(numberOfChannels, length, sampleRate) {
            this.numberOfChannels = numberOfChannels;
            this.length = length;
            this.sampleRate = sampleRate;
            this.destination = new MockAudioNode('destination');
            this.source = null;
            this.nodes = [];
            contexts.push(this);
        }

        createBufferSource() {
            this.source = new MockBufferSourceNode();
            return this.source;
        }

        createGain() {
            const node = new MockAudioNode(`effect-${this.nodes.length + 1}`);
            this.nodes.push(node);
            return node;
        }

        startRendering() {
            if (startRendering) {
                return startRendering(this);
            }

            return Promise.resolve(new MockAudioBuffer(
                this.numberOfChannels,
                this.length,
                this.sampleRate
            ));
        }
    }

    globalThis.OfflineAudioContext = MockOfflineAudioContext;

    return {
        contexts,
        restore() {
            if (typeof original === 'undefined') {
                delete globalThis.OfflineAudioContext;
            } else {
                globalThis.OfflineAudioContext = original;
            }
        }
    };
};
