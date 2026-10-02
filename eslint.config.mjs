import js from "@eslint/js";

export default [
  {
    ignores: ["node_modules/**", "dist/**", "release/**", ".local-backups/**"],
  },
  js.configs.recommended,
  {
    rules: {
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-unused-vars": [
        "error",
        {
          args: "none",
          caughtErrors: "none",
          varsIgnorePattern:
            "^(SW|sw|startup|shutdown|install|uninstall|onMainWindow)",
        },
      ],
    },
  },
  {
    files: ["bootstrap.js", "prefs.js", "src/**/*.js"],
    rules: { "no-redeclare": ["error", { builtinGlobals: false }] },
    languageOptions: {
      sourceType: "script",
      globals: Object.fromEntries(
        [
          "Zotero",
          "APP_SHUTDOWN",
          "Services",
          "ChromeUtils",
          "IOUtils",
          "PathUtils",
          "TextDecoder",
          "TextEncoder",
          "Ci",
          "SWSemantic",
          "setTimeout",
          "clearTimeout",
          "pref",
          "module",
          "SWSearch",
          "SWCorpus",
          "SWIndexer",
          "SWTokenizer",
          "SWSection",
          "SWPlugin",
          "SWPref",
          "SWResultLimit",
          "SW_MAX_TOKENS",
          "swPorterStem",
          "swYield",
        ].map((name) => [name, "readonly"]),
      ),
    },
  },
  {
    files: ["tests/**/*.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: Object.fromEntries(
        [
          "__dirname",
          "global",
          "console",
          "process",
          "TextEncoder",
          "TextDecoder",
          "TextEncoder",
          "Ci",
          "SWSemantic",
          "setTimeout",
          "clearTimeout",
          "setImmediate",
          "swPorterStem",
        ].map((name) => [name, "readonly"]),
      ),
    },
  },
  {
    files: ["ml/**/*.js"],
    languageOptions: {
      sourceType: "module",
      globals: { self: "readonly", Response: "readonly" },
    },
  },
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: { console: "readonly" } },
  },
];
