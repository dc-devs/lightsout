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
	testMatch: ['<rootDir>/src/**/*.unit.test.ts', '<rootDir>/src/**/*.unit.test.tsx'],
	// Re-declares the key the factory sets rather than adding to it: the factory
	// spreads the caller's keys last, so a repeated key replaces instead of
	// merging, and the shared setup file has to be named again to survive.
	setupFilesAfterEnv: [join(__dirname, '..', '..', 'tooling', 'jest', 'setupTestEnvironment.ts'), join(__dirname, 'tests', 'config', 'jest.setup.ts')],
	// Measure EVERY source file, not just the ones a test happens to import, and
	// exclude nothing but the tests themselves. A file left out of the report is
	// indistinguishable from a file no test ever loaded — the entries and the
	// route modules each have a test reaching them, and the report is where that
	// is visible. `src/markdown.d.ts` is in here too: a declaration file compiles
	// to nothing, so it lands at zero statements rather than going missing.
	collectCoverageFrom: ['src/**/*.ts', 'src/**/*.tsx', '!src/**/*.unit.test.ts', '!src/**/*.unit.test.tsx'],
	coverageReporters: ['text', 'lcov', 'json-summary'],
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
	},
});
