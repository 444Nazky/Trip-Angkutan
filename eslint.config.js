// @ts-check
const tseslint = require("typescript-eslint");
const reactHooks = require("eslint-plugin-react-hooks");

module.exports = tseslint.config(
  { ignores: ["www/**", "backend/**", "node_modules/**"] },
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Hanya dua rule klasik yang dipakai proyek ini. Preset lengkap
    // (recommended-latest) mengaktifkan aturan React Compiler yang belum
    // relevan di sini dan akan membanjiri lint dengan error yang bukan bug.
    //
    // Tanpa blok ini, direktif `eslint-disable-next-line react-hooks/exhaustive-deps`
    // di kode menunjuk rule yang tidak terdaftar -> ESLint melaporkannya sebagai
    // error "Definition for rule ... was not found" dan direktifnya tidak
    // memblokir apa pun.
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  }
);
