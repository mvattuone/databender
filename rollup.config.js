// rollup.config.js
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

export default {
  input: 'index.js',
  output: {
    file: 'dist/databender.js',
    name: 'Databender',
    format: 'iife',
    sourcemap: false,
  },
  plugins: [
    resolve({
      browser: true,       
      preferBuiltins: false, 
    }),
    commonjs({
      requireReturnsDefault: 'auto', 
    }),
  ]
};

