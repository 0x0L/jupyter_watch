export default {
  server: {
    proxy: {
      "/ws": {
        target: "ws://localhost:8765",
        ws: true,
      },
    },
  },
};
