
const isFunction = (candidate) => typeof candidate === 'function';

const isConnectable = (candidate) => candidate && typeof candidate.connect === 'function';

const isPromise = (candidate) => candidate && typeof candidate.then === 'function';

const normalizeEffectNode = (candidate) => {
    if (!candidate) {
        return null;
    }

    const input = isConnectable(candidate.input) ? candidate.input : candidate;
    const output = isConnectable(candidate.output) ? candidate.output : input;

    if (!isConnectable(input) || !isConnectable(output)) {
        return null;
    }

    return { input, output };
};

const asArray = (value) => {
    if (!value) {
        return [];
    }

    return Array.isArray(value) ? value : [value];
};

const normalizeChainMode = (value) => value === 'parallel' ? 'parallel' : 'series';

export default class Databender {
    constructor({
        config = {},
        effectsChain = null,
        chainMode,
        sourceParams = null,
        audioCtx = null
    } = {}) {
        this.audioCtx = audioCtx ? audioCtx : new AudioContext();
        this.channels = 1;
        this.config = config || {};
        this.configKeys = Object.keys(this.config);
        this.previousConfig = this.config;
        this.effectsChain = effectsChain ? asArray(effectsChain) : null;
        this.sourceParams = sourceParams ? asArray(sourceParams) : null;
        this.chainMode = normalizeChainMode(chainMode ?? this.config.chainMode);
        this.maxConcurrentRenders = 2;
        this.activeRenderCount = 0;
        this.renderQueue = [];
        const imageDataByBuffer = new WeakMap();

        this.convert = function(image) {
            if (image instanceof Image || image instanceof HTMLVideoElement) {
                const canvas = typeof OffscreenCanvas !== 'undefined'
                    ? new OffscreenCanvas(window.innerWidth, window.innerHeight)
                    : (() => {
                        const element = document.createElement('canvas');
                        element.width = window.innerWidth;
                        element.height = window.innerHeight;
                        return element;
                    })();
                var context = canvas.getContext('2d');
                context.drawImage(image, 0, 0, canvas.width, canvas.height);
                var imageData = context.getImageData(0, 0, canvas.width, canvas.height);
            }
            this.imageData = imageData || image;
            var bufferSize = this.imageData.data.length / this.channels;

            // Make an audioBuffer on the audioContext to pass to the offlineAudioCtx AudioBufferSourceNode
            var audioBuffer = this.audioCtx.createBuffer(this.channels, bufferSize, this.audioCtx.sampleRate);

            // This gives us the actual ArrayBuffer that contains the data
            var nowBuffering = audioBuffer.getChannelData(0);

            for (var i = 0; i < nowBuffering.length; i++) {
                nowBuffering[i] = (this.imageData.data[i] / 128) - 1;
            }

            imageDataByBuffer.set(audioBuffer, this.imageData);
            return Promise.resolve(audioBuffer);
        };

        this.configHasChanged = function() {
            if (!this.configKeys.length) {
                return false;
            }
            return JSON.stringify(this.previousConfig) !== JSON.stringify(this.config);
        };

        this.updateConfig = function(effect, param, value) {
            if (!this.configKeys.length || !this.config[effect]) {
                return;
            }
            if (typeof param === 'undefined') {
                this.config[effect] = value;
                if (effect === 'chainMode') {
                    this.chainMode = value;
                }
                return;
            }
            this.config[effect][param] = value;
        };

        this.render = async function(buffer, bypass = false) {
            const acquireRenderSlot = async () => {
                if (this.activeRenderCount < this.maxConcurrentRenders) {
                    this.activeRenderCount += 1;
                    return;
                }
                await new Promise((resolve) => {
                    this.renderQueue.push({ resolve });
                });
                this.activeRenderCount += 1;
            };

            const releaseRenderSlot = () => {
                this.activeRenderCount = Math.max(0, this.activeRenderCount - 1);
                const next = this.renderQueue.shift();
                if (next && isFunction(next.resolve)) {
                    next.resolve();
                }
            };

            await acquireRenderSlot();
            try {

            // Create offlineAudioCtx that will house our rendered buffer
            var offlineAudioCtx = new OfflineAudioContext(this.channels, buffer.length * this.channels, this.audioCtx.sampleRate);

            // Create an AudioBufferSourceNode, which represents an audio source consisting of in-memory audio data
            var bufferSource = offlineAudioCtx.createBufferSource();

            // Set buffer to audio buffer containing image data
            bufferSource.buffer = buffer;

            var resolveEffectsChain = async function() {
                if (bypass) {
                    return [];
                }

                var chainDefinition = null;

                if (this.effectsChain) {
                    chainDefinition = this.effectsChain;
                }

                if (isPromise(chainDefinition)) {
                    chainDefinition = await chainDefinition;
                }

                var candidates = asArray(chainDefinition);
                var resolvedNodes = [];

                for (var i = 0; i < candidates.length; i++) {
                    var nodeCandidate = candidates[i];
                    var resolvedNode = nodeCandidate;

                    if (isFunction(resolvedNode)) {
                        resolvedNode = resolvedNode({ context: offlineAudioCtx, source: bufferSource, config: this.config });
                    }

                    if (isPromise(resolvedNode)) {
                        resolvedNode = await resolvedNode;
                    }

                    var normalizedNodes = asArray(resolvedNode);

                    for (var j = 0; j < normalizedNodes.length; j++) {
                        var node = normalizedNodes[j];
                        resolvedNodes.push(isPromise(node) ? await node : node);
                    }
                }

                return resolvedNodes;
            }.bind(this);

            var applySourceParams = async function() {
                if (bypass || !this.sourceParams) {
                    return;
                }

                var candidates = asArray(this.sourceParams);

                for (var i = 0; i < candidates.length; i++) {
                    var candidate = candidates[i];
                    var result = candidate;

                    if (isFunction(result)) {
                        result = result({ context: offlineAudioCtx, source: bufferSource, config: this.config });
                    }

                    if (isPromise(result)) {
                        await result;
                    }
                }
            }.bind(this);

            await applySourceParams();

            var effectNodes = (await resolveEffectsChain()).map(normalizeEffectNode).filter(Boolean);

            if (!effectNodes.length) {
                bufferSource.connect(offlineAudioCtx.destination);
            } else if (this.chainMode === 'parallel') {
                effectNodes.forEach((node) => {
                    bufferSource.connect(node.input);
                    node.output.connect(offlineAudioCtx.destination);
                });
            } else {
                var previousNode = bufferSource;
                effectNodes.forEach((node) => {
                    previousNode.connect(node.input);
                    previousNode = node.output;
                });
                previousNode.connect(offlineAudioCtx.destination);
            }

            bufferSource.start();

            this.previousConfig = this.config;
            // Kick off the render, callback will contain rendered buffer in event
            const renderedBuffer = await offlineAudioCtx.startRendering();
            const imageData = imageDataByBuffer.get(buffer);
            if (imageData) {
                imageDataByBuffer.set(renderedBuffer, imageData);
            }
            return renderedBuffer;
            } finally {
                releaseRenderSlot();
            }
        };

        this.draw = function(buffer, context, sourceX = 0, sourceY = 0, x = 0, y = 0, sourceWidth, sourceHeight, targetWidth = window.innerWidth, targetHeight = window.innerHeight) {
            const imageData = imageDataByBuffer.get(buffer) || this.imageData;
            const resolvedSourceWidth = sourceWidth ?? imageData.width;
            const resolvedSourceHeight = sourceHeight ?? imageData.height;

            // Get buffer data
            var bufferData = buffer.getChannelData(0);

            // ImageData expects a Uint8ClampedArray so we need to make a typed array from our buffer
            // @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/ArrayBuffer
            var clampedDataArray = new Uint8ClampedArray(buffer.length);

            for (var k = 0; k < bufferData.length; k++) {
                var value = ((bufferData[k] + 1) * 128);
                clampedDataArray[k] = value < 0 ? 0 : (value > 255 ? 255 : value);
            }

            // putImageData requires an ImageData Object
            // @see https://developer.mozilla.org/en-US/docs/Web/API/ImageData
            const transformedImageData = new ImageData(imageData.width, imageData.height);
            transformedImageData.data.set(clampedDataArray);

            const tmpCanvas = typeof OffscreenCanvas !== 'undefined'
                ? new OffscreenCanvas(imageData.width, imageData.height)
                : (() => {
                    const element = document.createElement('canvas');
                    element.width = imageData.width;
                    element.height = imageData.height;
                    return element;
                })();
            tmpCanvas.getContext('2d').putImageData(transformedImageData, sourceX, sourceY);
            context.drawImage(tmpCanvas, sourceX, sourceY, resolvedSourceWidth, resolvedSourceHeight, x, y, targetWidth, targetHeight);
        };

        this.bend = function(data, context, sourceX = 0, sourceY = 0, x = 0, y = 0, targetWidth = window.innerWidth, targetHeight = window.innerHeight) {
            return this.convert(data)
                .then((buffer) => {
                    const imageData = imageDataByBuffer.get(buffer) || this.imageData;
                    return this.render(buffer).then((renderedBuffer) => ({ renderedBuffer, imageData }));
                })
                .then(({ renderedBuffer, imageData }) => this.draw(renderedBuffer, context, sourceX, sourceY, x, y, imageData.width, imageData.height, targetWidth, targetHeight));
        };

        return this;
    }
};
