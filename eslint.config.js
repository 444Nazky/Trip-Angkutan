// @ts-check
const tseslint = require("typescript-eslint");

module.exports = tseslint.config(
  { ignores: ["www/**", "backend/**", "node_modules/**"] },
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  }
);
