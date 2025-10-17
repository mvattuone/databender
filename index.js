
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

const normalizeConstructorInput = (configOrOptions) => {
    if (Array.isArray(configOrOptions)) {
        return { effectsChain: configOrOptions, config: null };
    }

    if (configOrOptions && typeof configOrOptions === 'object' && (configOrOptions.effectsChain || configOrOptions.createEffectsChain || configOrOptions.config)) {
        return {
            config: configOrOptions.config || null,
            effectsChain: configOrOptions.effectsChain || null,
            createEffectsChain: configOrOptions.createEffectsChain || null
        };
    }

    return { config: configOrOptions || null };
};

export default class Databender {
    constructor(configOrOptions, audioCtx) {
        const options = normalizeConstructorInput(configOrOptions);
        this.audioCtx = audioCtx ? audioCtx : new AudioContext();
        this.channels = 1;
        this.config = options.config || {};
        this.configKeys = Object.keys(this.config);
        this.previousConfig = this.config;
        this.effectsChain = options.effectsChain ? asArray(options.effectsChain) : null;
        this.createEffectsChain = options.createEffectsChain && isFunction(options.createEffectsChain)
            ? options.createEffectsChain
            : null;

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

            nowBuffering.set(this.imageData.data);

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
            this.config[effect][param] = value;
        };

        this.render = async function(buffer, bypass = false) {

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

                if (this.createEffectsChain) {
                    chainDefinition = this.createEffectsChain({ context: offlineAudioCtx, source: bufferSource, config: this.config });
                } else if (this.effectsChain) {
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

            var effectNodes = (await resolveEffectsChain()).map(normalizeEffectNode).filter(Boolean);

            if (!effectNodes.length) {
                bufferSource.connect(offlineAudioCtx.destination);
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
            return offlineAudioCtx.startRendering();
        };

        this.draw = function(buffer, context, sourceX = 0, sourceY = 0, x = 0, y = 0, sourceWidth = this.imageData.width, sourceHeight = this.imageData.height, targetWidth = window.innerWidth, targetHeight = window.innerHeight) {
            // Get buffer data
            var bufferData = buffer.getChannelData(0);

            // ImageData expects a Uint8ClampedArray so we need to make a typed array from our buffer
            // @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/ArrayBuffer
            var clampedDataArray = new Uint8ClampedArray(buffer.length);

            // set the renderedBuffer to Uint8ClampedArray to use in ImageData later
            clampedDataArray.set(bufferData);

            // putImageData requires an ImageData Object
            // @see https://developer.mozilla.org/en-US/docs/Web/API/ImageData
            const transformedImageData = new ImageData(this.imageData.width, this.imageData.height);
            transformedImageData.data.set(clampedDataArray);

            const tmpCanvas = typeof OffscreenCanvas !== 'undefined'
                ? new OffscreenCanvas(this.imageData.width, this.imageData.height)
                : (() => {
                    const element = document.createElement('canvas');
                    element.width = this.imageData.width;
                    element.height = this.imageData.height;
                    return element;
                })();
            tmpCanvas.getContext('2d').putImageData(transformedImageData, sourceX, sourceY);
            context.drawImage(tmpCanvas, sourceX, sourceY, sourceWidth, sourceHeight, x, y, targetWidth, targetHeight);
        };

        this.bend = function(data, context, sourceX = 0, sourceY = 0, x = 0, y = 0, targetWidth = window.innerWidth, targetHeight = window.innerHeight) {
            return this.convert(data)
                .then((buffer) => this.render(buffer))
                .then((buffer) => this.draw(buffer, context, sourceX, sourceY, x, y, this.imageData.width, this.imageData.height, targetWidth, targetHeight));
        };

        return this;
    }
};
