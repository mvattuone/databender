
const isFunction = (candidate) => typeof candidate === 'function';

const isConnectable = (candidate) => candidate && typeof candidate.connect === 'function';

const isPromise = (candidate) => candidate && typeof candidate.then === 'function';

const normalizeEffectNode = (candidate, context) => {
    if (!candidate) {
        return null;
    }

    const input = candidate.input ?? candidate;
    const output = candidate.output ?? input;

    if (!isConnectable(input) || !isConnectable(output)) {
        throw new TypeError('Effect factories must return an AudioNode or an { input, output } pair');
    }

    if ([input, output].some((node) => node.context && node.context !== context)) {
        throw new TypeError('Effect factories must create nodes with the provided OfflineAudioContext');
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

const isInstanceOfGlobal = (candidate, constructorName) => {
    const Constructor = globalThis[constructorName];
    return typeof Constructor === 'function' && candidate instanceof Constructor;
};

const isDrawableImage = (candidate) => [
    'Image',
    'HTMLImageElement',
    'HTMLVideoElement',
    'HTMLCanvasElement',
    'OffscreenCanvas',
    'ImageBitmap'
].some((constructorName) => isInstanceOfGlobal(candidate, constructorName));

const getImageDimensions = (image) => {
    const width = image.naturalWidth || image.videoWidth || image.width;
    const height = image.naturalHeight || image.videoHeight || image.height;

    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        throw new RangeError('Image sources must have positive dimensions');
    }

    return { width, height };
};

const isImageDataLike = (candidate) => {
    if (!candidate || !candidate.data) {
        return false;
    }

    const { width, height, data } = candidate;
    return Number.isInteger(width)
        && Number.isInteger(height)
        && width > 0
        && height > 0
        && data.length === width * height * 4;
};

const createCanvas = (width, height) => {
    if (typeof OffscreenCanvas !== 'undefined') {
        return new OffscreenCanvas(width, height);
    }

    if (typeof document === 'undefined') {
        throw new Error('A Canvas implementation is required to process image sources');
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
};

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

        this.convert = async function(image) {
            var imageData = image;
            if (isDrawableImage(image)) {
                const { width, height } = getImageDimensions(image);
                const canvas = createCanvas(width, height);
                const context = canvas.getContext('2d');
                if (!context) {
                    throw new Error('Unable to create a 2D canvas context');
                }
                context.drawImage(image, 0, 0, canvas.width, canvas.height);
                imageData = context.getImageData(0, 0, canvas.width, canvas.height);
            }
            if (!isImageDataLike(imageData)) {
                throw new TypeError('Expected ImageData or a supported canvas image source');
            }

            this.imageData = imageData;
            var bufferSize = this.imageData.data.length / this.channels;

            // Make an audioBuffer on the audioContext to pass to the offlineAudioCtx AudioBufferSourceNode
            var audioBuffer = this.audioCtx.createBuffer(this.channels, bufferSize, this.audioCtx.sampleRate);

            // This gives us the actual ArrayBuffer that contains the data
            var nowBuffering = audioBuffer.getChannelData(0);

            for (var i = 0; i < nowBuffering.length; i++) {
                nowBuffering[i] = (this.imageData.data[i] / 128) - 1;
            }

            imageDataByBuffer.set(audioBuffer, this.imageData);
            return audioBuffer;
        };

        this.configHasChanged = function() {
            return this.previousConfig !== this.config;
        };

        this.updateConfig = function(effect, param, value) {
            if (typeof param === 'undefined') {
                this.config = { ...this.config, [effect]: value };
                if (effect === 'chainMode') {
                    this.chainMode = normalizeChainMode(value);
                }
            } else {
                const currentEffectConfig = this.config[effect];
                const nextEffectConfig = currentEffectConfig && typeof currentEffectConfig === 'object'
                    ? { ...currentEffectConfig, [param]: value }
                    : { [param]: value };
                this.config = { ...this.config, [effect]: nextEffectConfig };
            }
            this.configKeys = Object.keys(this.config);
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
            const renderConfig = this.config;
            const renderChainMode = this.chainMode;

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
                    if (!isFunction(nodeCandidate)) {
                        throw new TypeError('effectsChain entries must be factory functions');
                    }
                    var resolvedNode = nodeCandidate({ context: offlineAudioCtx, source: bufferSource, config: renderConfig });

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
                    if (!isFunction(candidate)) {
                        throw new TypeError('sourceParams entries must be functions');
                    }
                    var result = candidate({ context: offlineAudioCtx, source: bufferSource, config: renderConfig });

                    if (isPromise(result)) {
                        await result;
                    }
                }
            }.bind(this);

            await applySourceParams();

            var effectNodes = (await resolveEffectsChain())
                .filter(Boolean)
                .map((node) => normalizeEffectNode(node, offlineAudioCtx));

            if (!effectNodes.length) {
                bufferSource.connect(offlineAudioCtx.destination);
            } else if (renderChainMode === 'parallel') {
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

            this.previousConfig = renderConfig;
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

        this.draw = function(buffer, context, sourceX = 0, sourceY = 0, x = 0, y = 0, sourceWidth, sourceHeight, targetWidth, targetHeight) {
            const imageData = imageDataByBuffer.get(buffer) || this.imageData;
            const resolvedSourceWidth = sourceWidth ?? imageData.width;
            const resolvedSourceHeight = sourceHeight ?? imageData.height;
            const resolvedTargetWidth = targetWidth
                ?? context.canvas?.width
                ?? (typeof window !== 'undefined' ? window.innerWidth : imageData.width);
            const resolvedTargetHeight = targetHeight
                ?? context.canvas?.height
                ?? (typeof window !== 'undefined' ? window.innerHeight : imageData.height);

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

            const tmpCanvas = createCanvas(imageData.width, imageData.height);
            tmpCanvas.getContext('2d').putImageData(transformedImageData, 0, 0);
            context.drawImage(tmpCanvas, sourceX, sourceY, resolvedSourceWidth, resolvedSourceHeight, x, y, resolvedTargetWidth, resolvedTargetHeight);
        };

        this.bend = function(data, context, sourceX = 0, sourceY = 0, x = 0, y = 0, targetWidth, targetHeight) {
            return this.convert(data)
                .then((buffer) => {
                    const imageData = imageDataByBuffer.get(buffer) || this.imageData;
                    return this.render(buffer).then((renderedBuffer) => ({ renderedBuffer, imageData }));
                })
                .then(({ renderedBuffer, imageData }) => this.draw(
                    renderedBuffer,
                    context,
                    sourceX,
                    sourceY,
                    x,
                    y,
                    Math.max(0, imageData.width - sourceX),
                    Math.max(0, imageData.height - sourceY),
                    targetWidth,
                    targetHeight
                ));
        };

        return this;
    }
};
