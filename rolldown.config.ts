// rolldown.config.ts
import { defineConfig } from 'rolldown';

export default defineConfig({
  input: 'src/main.ts',

  output: {
    dir: 'dist',
    format: 'esm',
    minify: true,
  },

  moduleTypes: {
    '.ejs': 'text',
    '.html': 'text',
  },
});
