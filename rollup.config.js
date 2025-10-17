// rollup.config.js
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';

export default {
  input: 'index.js',
  output: {
    file: 'dist/databender.js',
    name: 'Databender',
    format: 'iife',
    sourcemap: true
  },
  plugins: [
    resolve({
      browser: true,       
      preferBuiltins: false, 
    }),
    commonjs({
      requireReturnsDefault: 'auto', 
    }),
    json({ preferConst: true })
  ]
};

