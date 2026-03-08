import js from "@eslint/js";

export default [
  js.configs.recommended,
  {
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        // Browser globals
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        localStorage: "readonly",
        WebSocket: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        HTMLElement: "readonly",
        btoa: "readonly",
        fetch: "readonly",
        URL: "readonly",
      },
    },
  },
  {
    files: ["server.js"],
    languageOptions: {
      globals: {
        // Node globals
        process: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        Buffer: "readonly",
      },
    },
  },
  {
    ignores: ["dist/"],
  },
];
