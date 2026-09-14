import { mergeConfig } from "vite";
import config from "../vite.config.js";

export default mergeConfig(config, {
  server: {
    port: 5174,
    proxy: { "/ws": { target: "ws://127.0.0.1:8877" } },
  },
});
