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
        URL: "readonly",
        URLSearchParams: "readonly",
        console: "readonly",
        document: "readonly",
        fetch: "readonly",
        process: "readonly",
        setInterval: "readonly",
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
