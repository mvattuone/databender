import assert from 'node:assert/strict';
import test from 'node:test';

import Databender from '../index.js';
import {
    MockAudioBuffer,
    createAudioContext,
    createDeferred,
    installOfflineAudioContext
} from './helpers/web-audio.mjs';

const flushTasks = () => new Promise((resolve) => setImmediate(resolve));

test('connects effect factories in series by default', async (t) => {
    const offline = installOfflineAudioContext();
    t.after(offline.restore);

    const databender = new Databender({
        audioCtx: createAudioContext(),
        effectsChain: [
            ({ context }) => context.createGain(),
            ({ context }) => context.createGain()
        ]
    });

    await databender.render(new MockAudioBuffer(1, 4, 48000));

    const [context] = offline.contexts;
    const [firstEffect, secondEffect] = context.nodes;
    assert.deepEqual(context.source.connections, [firstEffect]);
    assert.deepEqual(firstEffect.connections, [secondEffect]);
    assert.deepEqual(secondEffect.connections, [context.destination]);
    assert.equal(context.source.started, true);
});

test('connects effects in parallel when requested by the public option', async (t) => {
    const offline = installOfflineAudioContext();
    t.after(offline.restore);

    const databender = new Databender({
        audioCtx: createAudioContext(),
        chainMode: 'parallel',
        effectsChain: [
            ({ context }) => context.createGain(),
            ({ context }) => context.createGain()
        ]
    });

    await databender.render(new MockAudioBuffer(1, 4, 48000));

    const [context] = offline.contexts;
    const [firstEffect, secondEffect] = context.nodes;
    assert.deepEqual(context.source.connections, [firstEffect, secondEffect]);
    assert.deepEqual(firstEffect.connections, [context.destination]);
    assert.deepEqual(secondEffect.connections, [context.destination]);
});

test('supports config.chainMode as a backwards-compatible fallback', () => {
    const databender = new Databender({
        audioCtx: createAudioContext(),
        config: { chainMode: 'parallel' }
    });

    assert.equal(databender.chainMode, 'parallel');
});

test('tracks immutable config updates, including missing and falsy keys', async (t) => {
    const offline = installOfflineAudioContext();
    t.after(offline.restore);
    const initialConfig = {
        enabled: false,
        gain: { value: 1 }
    };
    const databender = new Databender({
        audioCtx: createAudioContext(),
        config: initialConfig
    });

    databender.updateConfig('gain', 'value', 2);
    assert.equal(databender.config.gain.value, 2);
    assert.equal(initialConfig.gain.value, 1);
    assert.equal(databender.configHasChanged(), true);

    await databender.render(new MockAudioBuffer(1, 4, 48000));
    assert.equal(databender.configHasChanged(), false);

    databender.updateConfig('enabled', undefined, true);
    databender.updateConfig('mix', 'value', 0.5);
    databender.updateConfig('chainMode', undefined, 'parallel');
    assert.equal(databender.config.enabled, true);
    assert.deepEqual(databender.config.mix, { value: 0.5 });
    assert.equal(databender.chainMode, 'parallel');
    assert.equal(databender.configHasChanged(), true);
});

test('captures one config snapshot for an entire render', async (t) => {
    const offline = installOfflineAudioContext();
    t.after(offline.restore);
    const sourceParam = createDeferred();
    const observedConfigs = [];
    const databender = new Databender({
        audioCtx: createAudioContext(),
        config: { amount: 1 },
        sourceParams: [async ({ config }) => {
            observedConfigs.push(config);
            await sourceParam.promise;
        }],
        effectsChain: [({ context, config }) => {
            observedConfigs.push(config);
            return context.createGain();
        }]
    });

    const render = databender.render(new MockAudioBuffer(1, 4, 48000));
    await flushTasks();
    databender.updateConfig('amount', undefined, 2);
    sourceParam.resolve();
    await render;

    assert.equal(observedConfigs.length, 2);
    assert.equal(observedConfigs[0], observedConfigs[1]);
    assert.equal(observedConfigs[0].amount, 1);
    assert.equal(databender.configHasChanged(), true);
});

test('applies source parameters before creating effects and starting', async (t) => {
    const offline = installOfflineAudioContext();
    t.after(offline.restore);
    const events = [];

    const databender = new Databender({
        audioCtx: createAudioContext(),
        sourceParams: [({ source }) => {
            source.playbackRate = 0.5;
            events.push('source-param');
        }],
        effectsChain: [({ context, source }) => {
            assert.equal(source.started, false);
            assert.equal(source.playbackRate, 0.5);
            events.push('effect');
            return context.createGain();
        }]
    });

    await databender.render(new MockAudioBuffer(1, 4, 48000));

    assert.deepEqual(events, ['source-param', 'effect']);
});

test('bypass skips source parameters and effects', async (t) => {
    const offline = installOfflineAudioContext();
    t.after(offline.restore);
    let invoked = false;

    const databender = new Databender({
        audioCtx: createAudioContext(),
        sourceParams: [() => {
            invoked = true;
        }],
        effectsChain: [() => {
            invoked = true;
        }]
    });

    await databender.render(new MockAudioBuffer(1, 4, 48000), true);

    const [context] = offline.contexts;
    assert.equal(invoked, false);
    assert.deepEqual(context.source.connections, [context.destination]);
});

test('keeps excess renders queued until an active render settles', async (t) => {
    const pendingRenders = [];
    const offline = installOfflineAudioContext({
        startRendering() {
            const deferred = createDeferred();
            pendingRenders.push(deferred);
            return deferred.promise;
        }
    });
    t.after(offline.restore);

    const databender = new Databender({ audioCtx: createAudioContext() });
    const buffer = new MockAudioBuffer(1, 4, 48000);
    const renders = [
        databender.render(buffer),
        databender.render(buffer),
        databender.render(buffer)
    ];

    await flushTasks();

    assert.equal(offline.contexts.length, 2);
    assert.equal(databender.activeRenderCount, 2);
    assert.equal(databender.renderQueue.length, 1);

    pendingRenders[0].resolve(buffer);
    await flushTasks();

    assert.equal(offline.contexts.length, 3);
    assert.equal(databender.activeRenderCount, 2);
    assert.equal(databender.renderQueue.length, 0);

    pendingRenders.slice(1).forEach(({ resolve }) => resolve(buffer));
    await Promise.all(renders);

    assert.equal(databender.activeRenderCount, 0);
});

test('keeps image dimensions local to concurrent bend operations', async (t) => {
    const originalImage = globalThis.Image;
    const originalVideo = globalThis.HTMLVideoElement;
    globalThis.Image = class {};
    globalThis.HTMLVideoElement = class {};
    t.after(() => {
        if (typeof originalImage === 'undefined') {
            delete globalThis.Image;
        } else {
            globalThis.Image = originalImage;
        }
        if (typeof originalVideo === 'undefined') {
            delete globalThis.HTMLVideoElement;
        } else {
            globalThis.HTMLVideoElement = originalVideo;
        }
    });

    const pendingRenders = [];
    const draws = [];
    const databender = new Databender({ audioCtx: createAudioContext() });
    databender.render = (buffer) => {
        const deferred = createDeferred();
        pendingRenders.push({ buffer, ...deferred });
        return deferred.promise;
    };
    databender.draw = (buffer, context, sourceX, sourceY, x, y, sourceWidth, sourceHeight) => {
        draws.push({ sourceWidth, sourceHeight });
    };

    const firstImage = {
        width: 10,
        height: 11,
        data: new Uint8ClampedArray(10 * 11 * 4)
    };
    const secondImage = {
        width: 20,
        height: 21,
        data: new Uint8ClampedArray(20 * 21 * 4)
    };

    const firstBend = databender.bend(firstImage, {}, 0, 0, 0, 0, 100, 100);
    const secondBend = databender.bend(secondImage, {}, 0, 0, 0, 0, 100, 100);
    await flushTasks();

    pendingRenders[1].resolve(pendingRenders[1].buffer);
    await secondBend;
    pendingRenders[0].resolve(pendingRenders[0].buffer);
    await firstBend;

    assert.deepEqual(draws, [
        { sourceWidth: 20, sourceHeight: 21 },
        { sourceWidth: 10, sourceHeight: 11 }
    ]);
});
