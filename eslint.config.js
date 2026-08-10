export default [
  {
    ignores: ["coverage/", "node_modules/"]
  },
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        AbortSignal: "readonly",
        process: "readonly",
        Buffer: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        console: "readonly",
        document: "readonly",
        fetch: "readonly",
        navigator: "readonly",
        ResizeObserver: "readonly",
        setInterval: "readonly",
        structuredClone: "readonly",
        clearInterval: "readonly",
        window: "readonly"
      }
    },
    rules: {
      "eqeqeq": "error",
      "no-undef": "error",
      "no-unused-vars": "error",
      "no-useless-catch": "error"
    }
  }
];
