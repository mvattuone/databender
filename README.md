# Databender

This module creates interesting visuals by deliberately misusing the Web Audio API.
Inspired by [David Byrne](https://www.youtube.com/watch?v=Gea9SYUdJeY) and [AudioShop](https://github.com/robertfoss/audio_shop/)

## Getting Started

The quickest way to get _something_ on the page:

- Run `npm i databender` in your project and make sure you have an image to point to somewhere.
- Paste the following snippet into `index.html` and point the image to the location of the image you'd like to bend.

```html
<img
  crossorigin="anonymous"
  style="display:none"
  src="https://picsum.photos/800"
/>
<canvas height="1280" width="1280"></canvas>

<script src="node_modules/databender/dist/databender.js"></script>
<script>
  const img = document.querySelector("img");
  const canvas = document.querySelector("canvas");
  const context = canvas.getContext("2d");
  let databender;

  window.addEventListener("load", () => {
    document.addEventListener("click", async () => {
      // Construct once, in response to a user gesture, and reuse it.
      databender ??= new Databender({
        effectsChain: [({ context }) => {
          const filter = context.createBiquadFilter();
          filter.type = "highpass";
          filter.frequency.value = 400;
          return filter;
        }]
      });

      await databender.bend(
        img,
        context,
        0,
        0,
        0,
        0,
        canvas.width,
        canvas.height
      );
    });
  });
</script>
```

- Start up a server (e.g. `python3 -m http.server`)
- Behold!

Using an ES module aware bundler? You can import straight from npm:

```js
import Databender from "databender";

const databender = new Databender();
```

Need to stick with a classic `<script>` tag that isn't module friendly? The package includes `dist/databender.js`, an IIFE bundle that exposes `window.Databender`. Load that file on the page and the snippet above will work.

### Custom effect chains

Pass effect factory functions and they'll be chained in the order you provide. Each factory receives the new `OfflineAudioContext` used for that render, plus the source node and current config.

```js
import Databender from 'databender';

const databender = new Databender({
  effectsChain: [
    ({ context }) => {
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 400;
      return filter;
    },
    ({ context }) => {
      const gain = context.createGain();
      gain.gain.value = 0.8;
      return gain;
    }
  ]
});

databender.bend(img, context);
```

Effect factories can return nodes, `{ input, output }` pairs, arrays of either, or promises that resolve to those values. Databender waits on any promises before it starts rendering, which makes it possible to do async setup on the `OfflineAudioContext` (for example, loading an `AudioWorklet` module for each render).

Effects must be factories rather than pre-created nodes. Web Audio nodes belong to the context that created them, while Databender creates a fresh offline context for every render. Creating each node from the supplied `context` keeps the graph valid across repeated and concurrent renders.

You can also decide how the chain is wired. By default every effect is connected in series. Pass `chainMode: 'parallel'` to fan the source out to each effect and feed each branch directly into the offline destination.

#### Example: Pizzicato effects

```js
import Databender from 'databender';
import Pizzicato from 'pizzicato';

const swapPizzicatoContext = (EffectCtor, options) => ({ context }) => {
  const previous = Pizzicato.context;
  Pizzicato.context = context;
  try {
    const effect = new EffectCtor(options);
    return { input: effect.inputNode, output: effect.outputNode };
  } finally {
    Pizzicato.context = previous;
  }
};

const databender = new Databender({
  effectsChain: [
    swapPizzicatoContext(Pizzicato.Effects.Delay, {
      feedback: 0.6,
      time: 0.4,
      mix: 0.5
    }),
    swapPizzicatoContext(Pizzicato.Effects.LowPassFilter, {
      frequency: 1200,
      peak: 10,
      mix: 0.4
    })
  ]
});

databender.bend(img, context);
```

(Note: `swapPizzicatoContext` is a tiny helper that swaps Pizzicato's internal context to the offline one Databender uses during rendering, then returns the effect's input/output nodes so Databender can connect it in sequence.)

#### Example: AudioWorklet

```js
import Databender from 'databender';

const useBitcrusher = async ({ context }) => {
  await context.audioWorklet.addModule('/path/to/effects/bitcrusher.js');
  return new AudioWorkletNode(context, 'bitcrusher');
};

const databender = new Databender({
  config,
  effectsChain: [useBitcrusher],
  chainMode: 'parallel'
});

databender.bend(img, context);
```

Because Databender spins up a brand new `OfflineAudioContext` for every render, the worklet module has to be registered on that context before the node is created. Returning a promise from your effect factory ensures the render waits for the module to load.

### Source parameters

Some tweaks (e.g. `detune` or `playbackRate`) must be applied directly to the `AudioBufferSourceNode` **before** it starts. Pass functions to `sourceParams` and they'll run prior to chaining any effects. Each factory receives the same payload (`{ context, source, config }`) as the regular effect chain.

```js
const databender = new Databender({
  config,
  sourceParams: [
    ({ source, config }) => {
      const value = config?.detune?.value ?? 0;
      source.detune.value = value;
    }
  ],
  effectsChain: [
    useDelayEffect(),
    useBitcrusher()
  ]
});
```

## API reference

TypeScript declarations are included with the package.

### `new Databender(options?)`

| Option | Default | Description |
| --- | --- | --- |
| `config` | `{}` | Values passed unchanged to every effect and source-parameter factory. |
| `effectsChain` | `null` | One effect factory or an array of factories. |
| `chainMode` | `'series'` | Use `'parallel'` to fan the source out to every effect. |
| `sourceParams` | `null` | One function or an array of functions that configure the source before it starts. |
| `audioCtx` | new `AudioContext()` | Context used to allocate input buffers and select the sample rate. Reuse the Databender instance or provide your own context. |

Both factory types receive `{ context, source, config }`. The `context` is the `OfflineAudioContext` for that specific render, so nodes must be created inside a factory rather than ahead of time.

### `bend(source, context, sourceX?, sourceY?, x?, y?, targetWidth?, targetHeight?)`

Converts, renders, and draws an image in one call. `source` may be `ImageData`, an image or video element, a canvas, an `OffscreenCanvas`, or an `ImageBitmap`. The returned promise resolves after drawing is complete.

The source defaults to the complete image. A nonzero `sourceX` or `sourceY` crops from that origin to the opposite edge. The target size defaults to `context.canvas.width` and `context.canvas.height`, then to the viewport when the context has no canvas.

```js
await databender.bend(image, canvasContext);
```

### Lower-level methods

- `convert(source)` returns a `Promise<AudioBuffer>` containing normalized RGBA bytes.
- `render(buffer, bypass = false)` runs the buffer through a fresh offline graph. With `bypass` enabled, it skips source parameters and effects. At most two renders run concurrently; additional calls wait in FIFO order.
- `draw(buffer, context, sourceX?, sourceY?, x?, y?, sourceWidth?, sourceHeight?, targetWidth?, targetHeight?)` draws a rendered buffer. Unlike the other pipeline methods, it is synchronous.

Conversion, rendering, and `bend()` report failures by rejecting their promises. Cross-origin image and video sources must provide CORS headers or canvas pixel access will reject with a browser security error.

### Updating config

Use `updateConfig()` rather than mutating `databender.config` directly. Updates replace the affected config branch, so each in-flight render keeps one consistent snapshot.

```js
databender.updateConfig('filter', 'frequency', 800);
databender.updateConfig('chainMode', undefined, 'parallel');

if (databender.configHasChanged()) {
  await databender.bend(image, canvasContext);
}
```

`configHasChanged()` reports whether `updateConfig()` has changed the configuration since the most recent render began.

### Browser requirements

A modern browser with the Web Audio API, `OfflineAudioContext`, and the Canvas 2D API. Native ES module consumers can import the package root; classic scripts can load `dist/databender.js` and use `window.Databender`.

Databender turns all four RGBA bytes into audio samples, so image size directly controls render cost. Start with modest input dimensions when using expensive effects or rapid interaction.

## Contributing

Creating a `CONTRIBUTING.md` is on the list of things to do. Feel free to submit issues/PRs.

## License

This project is licensed under the MIT License - see the [LICENSE.md](LICENSE.md) file for details

## Examples

[Drawdio](https://mvattuone.github.io/webaudio-databend)  
[Jonathan Taylor Tuner](https://mvattuone.github.io/jtt/)  
[Granular Synth](https://mvattuone.github.io/triticale/)  
[Conway's Game of Databending](https://mvattuone.github.io/vattuonet-v2/)
