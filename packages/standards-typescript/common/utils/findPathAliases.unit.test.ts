import { describe, expect, test } from '@jest/globals';
import { findPathAliases } from './findPathAliases.ts';

/** The run's text, holding whichever tsconfigs a case puts in scope. */
const setupContents = ({ configs }: { configs: Array<[string, string]> }) => ({ contents: new Map(configs) });

const aliasConfig = '{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }';

describe('findPathAliases', () => {
	test("takes the package's own tsconfig for a file inside it, not the repo root's", () => {
		const { contents } = setupContents({
			configs: [
				['tsconfig.json', '{ "include": ["tooling/**/*.ts"] }'],
				['packages/engine/tsconfig.json', aliasConfig],
			],
		});

		const aliases = findPathAliases({ path: 'packages/engine/src/agents/index.ts', contents });

		expect(aliases).toStrictEqual({ base: 'packages/engine', patterns: new Map([['@/*', ['./src/*']]]) });
	});

	test('falls back to the repo root for a file that no package encloses', () => {
		const { contents } = setupContents({ configs: [['tsconfig.json', aliasConfig]] });

		const aliases = findPathAliases({ path: 'tooling/jest/setupTestEnvironment.ts', contents });

		expect(aliases?.base).toBe('.');
	});

	test('takes the nearest config, so a nested package overrides the one above it', () => {
		const { contents } = setupContents({
			configs: [
				['packages/engine/tsconfig.json', aliasConfig],
				['packages/engine/nested/tsconfig.json', '{ "compilerOptions": { "paths": { "~/*": ["./lib/*"] } } }'],
			],
		});

		const aliases = findPathAliases({ path: 'packages/engine/nested/src/thing.ts', contents });

		expect(aliases?.patterns).toStrictEqual(new Map([['~/*', ['./lib/*']]]));
	});

	test('answers undefined when no tsconfig sits above the file at all', () => {
		const { contents } = setupContents({ configs: [] });

		const aliases = findPathAliases({ path: 'packages/engine/src/agents/index.ts', contents });

		expect(aliases).toBeUndefined();
	});

	test('answers undefined when the nearest config inherits its options, since the aliases may live in the parent', () => {
		const { contents } = setupContents({ configs: [['packages/engine/tsconfig.json', '{ "extends": "../../tsconfig.base.json" }']] });

		const aliases = findPathAliases({ path: 'packages/engine/src/agents/index.ts', contents });

		expect(aliases).toBeUndefined();
	});

	test('a config for a sibling package is never borrowed', () => {
		const { contents } = setupContents({ configs: [['packages/other/tsconfig.json', aliasConfig]] });

		const aliases = findPathAliases({ path: 'packages/engine/src/agents/index.ts', contents });

		expect(aliases).toBeUndefined();
	});
});
