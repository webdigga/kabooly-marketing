import js from "@eslint/js";
import tseslint from "typescript-eslint";

const strictRules = {
  complexity: ["error", 10],
  "max-depth": ["error", 3],
  "max-nested-callbacks": ["error", 3],
  "max-params": ["error", 4],
  "max-lines-per-function": [
    "error",
    { max: 100, skipBlankLines: true, skipComments: true, IIFEs: true },
  ],
  "max-lines": ["error", { max: 500, skipBlankLines: true, skipComments: true }],
  eqeqeq: ["error", "always"],
  curly: ["error", "multi-line"],
  "no-console": ["error", { allow: ["warn", "error"] }],
  "prefer-const": "error",
  "no-var": "error",
  "object-shorthand": "error",
  "prefer-template": "error",
  "prefer-arrow-callback": "error",
  "no-implicit-coercion": "error",
  "no-else-return": ["error", { allowElseIf: false }],
  "no-lonely-if": "error",
  "no-nested-ternary": "error",
  "no-param-reassign": "error",
  "no-return-assign": "error",
  "no-sequences": "error",
  "no-unneeded-ternary": "error",
  "no-useless-return": "error",
  "no-useless-concat": "error",
  "no-useless-rename": "error",
  "default-case-last": "error",
  "guard-for-in": "error",
  "no-alert": "error",
  "no-eval": "error",
  "no-new-func": "error",
  "no-bitwise": "error",
  "no-multi-assign": "error",
  "no-undef-init": "error",
  radix: "error",
  yoda: "error",
  "@typescript-eslint/no-shadow": "error",
  "@typescript-eslint/switch-exhaustiveness-check": "error",
  "@typescript-eslint/consistent-type-imports": "error",
  "@typescript-eslint/no-unused-vars": [
    "error",
    { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
  ],
  "@typescript-eslint/restrict-template-expressions": [
    "error",
    { allowNumber: true },
  ],
};

export default tseslint.config(
  { ignores: ["node_modules", ".wrangler", "migrations"] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: strictRules,
  },
  {
    files: ["**/*.js", "drizzle.config.ts"],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    // Test suites legitimately hold long describe blocks and deep callbacks.
    files: ["test/**"],
    rules: {
      "max-lines-per-function": "off",
      "max-lines": "off",
      "max-nested-callbacks": ["error", 5],
    },
  }
);
