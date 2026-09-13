import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";

/**
 * eslint-config-next v16 は Flat Config をそのまま公開しているため、
 * @eslint/eslintrc の FlatCompat は使わない。
 * FlatCompat 経由だと next/core-web-vitals の循環参照で設定読み込みごと落ちる。
 */
const eslintConfig = [
  { ignores: [".next/**", "node_modules/**", "out/**", "coverage/**", ".open-next/**"] },
  ...nextCoreWebVitals,
  ...nextTypescript,
  prettier,
  {
    rules: {
      // CLAUDE.md §38: any を広く使わない
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
];

export default eslintConfig;
