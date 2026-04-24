import neostandard from "neostandard";

export default [
  {
    ignores: [
      "node_modules/**",
      ".yarn/**",
      "coverage/**"
    ]
  },
  ...neostandard({ semi: true }),
  {
    rules: {
      "@stylistic/quotes": ["error", "double", { avoidEscape: true, allowTemplateLiterals: true }],
      "@stylistic/quote-props": "off"
    }
  }
];
