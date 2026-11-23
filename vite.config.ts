import { fileURLToPath, URL } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';

/**
 * Chunks that hold nothing but libraries ship without source maps. These are the parts of Mermaid, loaded only when
 * a diagram is drawn (#279): their maps would add about 18 MB to every installer and describe code that is not ours.
 * The maps of the app's own code stay.
 */
function dropLibrarySourceMaps(): Plugin {
  return {
    name: 'sketchdraw:drop-library-source-maps',
    apply: 'build',
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk' || chunk.isEntry) continue;
        const modules = Object.keys(chunk.modules);
        if (!modules.length || !modules.every((id) => id.includes('/node_modules/'))) continue;
        delete bundle[`${chunk.fileName}.map`];
        chunk.map = null;
        chunk.code = chunk.code.replace(/\n\/\/# sourceMappingURL=\S+\s*$/, '\n');
      }
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [vue(), dropLibrarySourceMaps()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // ELK (EPL-2.0 or GPL-3.0) is not shipped; see the stub.
      'elkjs/lib/elk.bundled.js': fileURLToPath(new URL('./src/renderer/lib/stubs/elk.ts', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
  },
});
