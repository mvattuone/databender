# Databender

This module allows for generation interesting visuals by misusing the Web Audio API.
Inspired by [David Byrne](https://www.youtube.com/watch?v=Gea9SYUdJeY) and [AudioShop](https://github.com/robertfoss/audio_shop/)

Full API documentation and such is _coming soon_.

## Getting Started

The quickest way to get _something_ on the page:

- Run `npm i databender` in your project and make sure you have an image to point to somewhere.
- Paste the following snippet into `index.html` and point the image to the location of the image you'd like to bend.

```html
<img
  crossorigin="anonymous"
  style="display:none"
  src="http://picsum.photos/800"
/>
<canvas height="1280" width="1280"></canvas>

<script src="node_modules/databender/dist/databender.js"></script>
<script>
  const loadDatabender = () => {
    const img = document.querySelector("img");
    const canvas = document.querySelector("canvas");
    const context = canvas.getContext("2d");
    const config = {
      bitcrusher: {
        active: true,
        bits: 4,
        normfreq: 0.004,
        bufferSize: 2048
      },
      biquad: {
        active: true,
        detune: 20,
        randomize: true,
        quality: 2.1,
        randomValues: 10,
        type: "highpass",
        biquadFrequency: 200
      },
      detune: {
        active: true,
        value: 0.0
      }
    };
    const databender = new Databender(config);
    databender.bend(img, context);
  };

  window.onload = () => {
    document.addEventListener("click", () => {
      loadDatabender();
    });
  };
</script>
```

- Start up a server (e.g. `python -m SimpleHTTPServer`)
- Behold!

Using an ES module aware bundler? You can import straight from npm:

```js
import Databender from "databender";

const databender = new Databender(config);
```

Need to stick with a classic `<script>` tag that isn't module friendly? `npm run build` will drop an IIFE bundle into `dist/databender.js` that exposes `window.Databender` just like before. Drop that bundle on the page and the snippet above will still work.

### Custom effect chains

You can inject any Web Audio nodes (Tone.js, Pizzicato, TunaJS, etc.) and they'll be chained in theorder you provide. 

```js
import Databender from 'databender';

const databender = new Databender([
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
]);

databender.bend(img, context);
```

You can also supply a `createEffectsChain` function if you need to build different chains per render. When using libraries like Tone.js or Pizzicato, return either the relevant `AudioNode` or an object shaped like `{ input: node.input, output: node.output }` so Databender knows how to wire things up.

#### Example: Pizzicato effects

```js
import Databender from 'databender';
import Pizzicato from 'pizzicato';

const swapPizzicatoContext = (EffectCtor, options) => ({ context }) => {
  // swap pizzicato internal context=
  const previous = Pizzicato.context;
  Pizzicato.context = context;
  const effect = new EffectCtor(options);
  Pizzicato.context = previous;
  return { input: effect.inputNode, output: effect.outputNode };
};

const databender = new Databender([
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
]);

databender.bend(img, context);
```

(Note: `swapPizzicatoContext` is a tiny helper that swaps Pizzicato's internal context to the offline one Databender uses during rendering, then returns the effect's input/output nodes so Databender can connect it in sequence.)

### Prerequisites

Google Chrome (ideally) and an open mind!

## Contributing

Creating a `CONTRIBUTING.md` is on the list of things to do. Feel free to submit issues/PRs.

## License

This project is licensed under the MIT License - see the [LICENSE.md](LICENSE.md) file for details

## Examples

[Drawdio](https://mvattuone.github.io/webaudio-databend)  
[Jonathan Taylor Tuner](https://mvattuone.github.io/jtt/)  
[Granular Synth](https://mvattuone.github.io/triticale/)  
[Conway's Game of Databending](https://mvattuone.github.io/vattuonet-v2/)
