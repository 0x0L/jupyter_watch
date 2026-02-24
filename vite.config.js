export default {
  server: {
    proxy: {
      "/": {
        target: "ws://localhost:8765",
        ws: true,
      },
    },
  },
};
