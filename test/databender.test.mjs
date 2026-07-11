import assert from 'node:assert/strict';
import test from 'node:test';

import Databender from '../index.js';
import {
    MockAudioBuffer,
    createAudioContext,
    installOfflineAudioContext
} from './helpers/web-audio.mjs';

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
