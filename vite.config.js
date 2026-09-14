import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
export default {
  build: { outDir: "src/jupyter_watch/static", emptyOutDir: true },
  resolve: {
    alias: { json5: require.resolve("json5"), "sanitize-html": require.resolve("sanitize-html") },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/ws": { target: "ws://127.0.0.1:8765", ws: true, changeOrigin: true },
    },
  },
};
