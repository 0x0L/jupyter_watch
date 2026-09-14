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
        structuredClone: "readonly",
        ResizeObserver: "readonly",
        fetch: "readonly",
        URL: "readonly",
      },
    },
  },
  {
    files: ["tests/**/*.js", "playwright.config.js"],
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
    ignores: [
      "src/jupyter_watch/static/",
      "dist/",
      ".venv/",
      ".test-runtime/",
      "test-results/",
      "playwright-report/",
    ],
  },
];
