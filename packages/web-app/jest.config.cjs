const { join } = require('node:path');
const createJestConfig = require('../../tooling/jest/createJestConfig.cjs');

// The web app's suite: jsdom, because most of what it owns is a React
// component, and Testing Library's matchers on top of the shared setup.
//
// No `moduleNameMapper` for `#src`. Four packages in this workspace spell their
// private alias the same way, and a mapper is project-global — it would rewrite
// the engine's own `#src` imports onto this package's src/ the moment a test
// loaded engine source. Jest 30 resolves package `imports` from the manifest
// owning the importing file, which is the only answer that stays correct.
module.exports = createJestConfig({
	rootDir: __dirname,
	testEnvironment: 'jsdom',
	// jsdom resolves package exports under the `browser` condition by default,
	// which hands back ESM builds for dependencies the engine reaches (`yaml`
	// ships a browser ESM entry) and breaks the CommonJS loader ts-jest compiles
	// for. These are the conditions this code actually runs under on a server.
	testEnvironmentOptions: { customExportConditions: ['require', 'node'] },
	// `tests/` is in here alongside `src/`: a suite that polices the source tree
	// as text names no subject beside it, so it lives in the package's own
	// tests/ directory rather than pretending to be a file's unit test.
	testMatch: ['<rootDir>/src/**/*.unit.test.ts', '<rootDir>/src/**/*.unit.test.tsx', '<rootDir>/tests/**/*.unit.test.ts', '<rootDir>/tests/**/*.unit.test.tsx'],
	// Re-declares the key the factory sets rather than adding to it: the factory
	// spreads the caller's keys last, so a repeated key replaces instead of
	// merging, and the shared setup file has to be named again to survive.
	setupFilesAfterEnv: [join(__dirname, '..', '..', 'tooling', 'jest', 'setupTestEnvironment.ts'), join(__dirname, 'tests', 'config', 'jest.setup.ts')],
	// Measure EVERY source file this app writes, not just the ones a test
	// happens to import. A file left out of the report is
	// indistinguishable from a file no test ever loaded — the entries and the
	// route modules each have a test reaching them, and the report is where that
	// is visible. `src/markdownAsText.d.ts` is in here too: a declaration
	// file compiles to nothing, so it lands at zero statements rather than
	// going missing.
	//
	// The one exception is `src/common/components/ui/` — shadcn/ui components,
	// written by their CLI rather than by this app. They are listed under
	// `vendored` in lightsout.config.json, which stops the engine writing tests
	// for them; measuring them here would then hold the threshold against code
	// nothing is allowed to cover. Components this app authors live in
	// `src/appUI/` and are measured like everything else.
	collectCoverageFrom: ['src/**/*.ts', 'src/**/*.tsx', '!src/**/*.unit.test.ts', '!src/**/*.unit.test.tsx', '!src/common/components/ui/**'],
	coverageThreshold: { global: { statements: 95, branches: 95, functions: 95, lines: 95 } },
	// The only mappers this package carries, and never for `#src`.
	// `@tanstack/react-start` and its subpaths publish an `import` condition and
	// nothing else, so Jest's CommonJS resolver cannot load them however it is
	// configured.
	moduleNameMapper: {
		'^@tanstack/react-start$': join(__dirname, 'tests', 'stubs', 'tanstackReactStart.ts'),
		'^@tanstack/react-start/client$': join(__dirname, 'tests', 'stubs', 'tanstackReactStartClient.ts'),
		'^@tanstack/react-start/server$': join(__dirname, 'tests', 'stubs', 'tanstackReactStartServer.ts'),
		'^@tanstack/react-start/server-entry$': join(__dirname, 'tests', 'stubs', 'tanstackReactStartServerEntry.ts'),
		// `?url` on a stylesheet import is a Vite instruction rather than a module
		// reference, so nothing matching that specifier exists on disk and the root
		// route cannot be required without a stand-in.
		'\\.css(\\?.*)?$': join(__dirname, 'tests', 'stubs', 'styleUrl.ts'),
		// `react-markdown` and `remark-gfm` are ESM-only, as is everything they
		// depend on, and the shared transform compiles only `.ts`, `.tsx` and
		// `.md`. Parsing is the library's contract; what this app owns is the
		// `components` map, and the stubs call through it. Real rendering is proved
		// by `nx build web-app` and the dev run.
		'^react-markdown$': join(__dirname, 'tests', 'stubs', 'reactMarkdown.tsx'),
		'^remark-gfm$': join(__dirname, 'tests', 'stubs', 'remarkGfm.ts'),
	},
});
