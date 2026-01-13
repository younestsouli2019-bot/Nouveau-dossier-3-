export default [
  {
    ignores: [
      ".qodo/**",
      "rank/**",
      "rank_mirror/**",
      "exports/**",
      "settlements/**",
      "reports/**/historic/**"
    ]
  },
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module"
    },
    rules: {
      eqeqeq: "off",
      "no-unused-vars": "off"
    }
  }
];
