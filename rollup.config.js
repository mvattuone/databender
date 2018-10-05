// rollup.config.js
import commonjs from 'rollup-plugin-commonjs';
import resolve from 'rollup-plugin-node-resolve';
import json from 'rollup-plugin-json';

export default {
  input: 'index.js',
  output: {
    file: 'dist/databender.js',
    name: 'Databender',
    format: 'iife'
  },
  plugins: [
    commonjs(),
    resolve(),
    json({
      exclude: 'node_modules/**',
      preferConst: true
    })
  ]
};
