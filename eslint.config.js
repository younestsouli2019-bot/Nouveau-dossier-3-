export default [
	{
		ignores: [
			".qodo/**",
			"rank/**",
			"rank_mirror/**",
			"exports/**",
			"settlements/**",
			"reports/**/historic/**",
			// Next build output. Its generated chunks carry inline
			// eslint-disable directives for plugins this config does not load,
			// which ESLint reports as errors ("Definition for rule ... was not
			// found"). Build output must never be linted.
			".next/**",
			// Vendored third-party scripts (legacy `with` statements, ES5).
			"scripts/lib/vendor/**",
		],
	},
	{
		files: ["**/*.js", "**/*.mjs"],
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: "module",
		},
		rules: {
			eqeqeq: "off",
			"no-unused-vars": "off",
		},
	},
];
