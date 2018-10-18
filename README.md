# Databender

This module allows for generation interesting visuals by misusing the Web Audio API. 
Inspired by [David Byrne](https://www.youtube.com/watch?v=Gea9SYUdJeY) and [AudioShop](https://github.com/robertfoss/audio_shop/)

Full API documentation and such is _coming soon_.

## Getting Started

The quickest way to get _something_ on the page:

* Run `npm i` in your project and make sure you have an image to point to somewhere.
* Paste the following snippet into `index.html` and point the image to the location of the image you'd like to bend.
```html
<img style="display:none" src="./test.jpg" />
<canvas height=1280 width=1280></canvas>

<script src="node_modules/databender/dist/databender.js"></script>
<script>
  window.onload = () => {
    const img = document.querySelector('img');
    const canvas = document.querySelector('canvas');
    const context = canvas.getContext('2d');
    const config = {
      detune: {
        active: true,
        value: 0.0007
      }
    }
    const databender = new Databender(config);
    databender.bend(img, context);
  }
</script>
```
* Start up a server (e.g. `python -m SimpleHTTPServer`)
* Behold!

You might also prefer using this in a CommonJS manner:

```js
const Databender = require('databender');
```
### Prerequisites

Google Chrome (ideally) and an open mind!

## Built With

* [TunaJS](https://github.com/Theodeus/tuna) - A splendid audio effects library.
* [Rollup](https://github.com/rollup/rollup) - Module bundling

## Contributing

Creating a `CONTRIBUTING.md` is on the list of things to do. Feel free to submit issues/PRs.

## License

This project is licensed under the MIT License - see the [LICENSE.md](LICENSE.md) file for details

## Examples

[Drawdio](https://mvattuone.github.io/webaudio-databend)  
[Jonathan Taylor Tuner](https://mvattuone.github.io/jtt/)  
[Granular Synth](https://mvattuone.github.io/triticale/)  
[Conway's Game of Databending](https://mvattuone.github.io/vattuonet-v2/)  
