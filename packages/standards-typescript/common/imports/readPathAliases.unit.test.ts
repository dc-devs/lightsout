import { describe, expect, test } from '@jest/globals';
import { readPathAliases } from './readPathAliases.ts';

/** A tsconfig as it is actually written in this repo: comments, tabs and a trailing comma. */
const setupConfig = ({ body }: { body: string }) => ({ tsconfigPath: 'packages/engine/tsconfig.json', text: body });

describe('readPathAliases', () => {
	test('maps each alias pattern to the targets it names', () => {
		const { tsconfigPath, text } = setupConfig({
			body: '{ "compilerOptions": { "paths": { "@/*": ["./src/*"], "@tests/*": ["./tests/*"] } } }',
		});

		const aliases = readPathAliases({ tsconfigPath, text });

		expect(aliases?.patterns).toStrictEqual(
			new Map([
				['@/*', ['./src/*']],
				['@tests/*', ['./tests/*']],
			]),
		);
	});

	test('anchors the targets to the folder holding the tsconfig, which is what resolves them', () => {
		const { tsconfigPath, text } = setupConfig({ body: '{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }' });

		const aliases = readPathAliases({ tsconfigPath, text });

		expect(aliases?.base).toBe('packages/engine');
	});

	test('anchors to baseUrl instead when the config sets one, the way TypeScript does', () => {
		const { tsconfigPath, text } = setupConfig({ body: '{ "compilerOptions": { "baseUrl": "./src", "paths": { "@/*": ["./*"] } } }' });

		const aliases = readPathAliases({ tsconfigPath, text });

		expect(aliases?.base).toBe('packages/engine/src');
	});

	test('reads a config written with comments and a trailing comma, which no JSON parser accepts', () => {
		const { tsconfigPath, text } = setupConfig({
			body: `{
	// the alias every package here declares for itself
	"compilerOptions": {
		"paths": {
			/* source */ "@/*": ["./src/*"],
		},
	},
}`,
		});

		const aliases = readPathAliases({ tsconfigPath, text });

		expect(aliases?.patterns).toStrictEqual(new Map([['@/*', ['./src/*']]]));
	});

	test('leaves a double slash inside a string alone, so a URL is not read as a comment', () => {
		const { tsconfigPath, text } = setupConfig({
			body: '{ "$schema": "https://json.schemastore.org/tsconfig", "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }',
		});

		const aliases = readPathAliases({ tsconfigPath, text });

		expect(aliases?.patterns).toStrictEqual(new Map([['@/*', ['./src/*']]]));
	});

	test('keeps every target of an alias that names more than one', () => {
		const { tsconfigPath, text } = setupConfig({ body: '{ "compilerOptions": { "paths": { "@/*": ["./src/*", "./generated/*"] } } }' });

		const aliases = readPathAliases({ tsconfigPath, text });

		expect(aliases?.patterns.get('@/*')).toStrictEqual(['./src/*', './generated/*']);
	});

	test('an empty alias map is a real answer for a config that declares none and inherits nothing', () => {
		const { tsconfigPath, text } = setupConfig({ body: '{ "compilerOptions": { "strict": true } }' });

		// not undefined: nothing is aliased here, so a bare specifier really is a
		// published package and a rule may say so
		const aliases = readPathAliases({ tsconfigPath, text });

		expect(aliases).toStrictEqual({ base: 'packages/engine', patterns: new Map() });
	});

	test('answers undefined for a config that declares no paths but extends another, since the aliases may be inherited', () => {
		const { tsconfigPath, text } = setupConfig({ body: '{ "extends": "../../tsconfig.base.json", "compilerOptions": { "strict": true } }' });

		const aliases = readPathAliases({ tsconfigPath, text });

		expect(aliases).toBeUndefined();
	});

	test('its own paths win over an extends, since a declared block is not inherited', () => {
		const { tsconfigPath, text } = setupConfig({ body: '{ "extends": "../../tsconfig.base.json", "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }' });

		const aliases = readPathAliases({ tsconfigPath, text });

		expect(aliases?.patterns).toStrictEqual(new Map([['@/*', ['./src/*']]]));
	});

	test('a paths block holding nothing is no aliases, not an unreadable config', () => {
		const { tsconfigPath, text } = setupConfig({ body: '{ "compilerOptions": { "paths": {} } }' });

		const aliases = readPathAliases({ tsconfigPath, text });

		expect(aliases).toStrictEqual({ base: 'packages/engine', patterns: new Map() });
	});

	test('skips an escaped quote inside a string, so the text after it is still read as a string and not as a comment', () => {
		// one unbalanced-looking quote is enough to desync every string boundary
		// that follows, and the next `//` then blanks a real line
		const { tsconfigPath, text } = setupConfig({
			body: `{
	"note": "an odd \\" quote, and the file goes on",
	"$schema": "https://json.schemastore.org/tsconfig",
	"compilerOptions": { "paths": { "@/*": ["./src/*"] } }
}`,
		});

		const aliases = readPathAliases({ tsconfigPath, text });

		expect(aliases).toStrictEqual({ base: 'packages/engine', patterns: new Map([['@/*', ['./src/*']]]) });
	});

	test('ignores a paths block that a multi-line comment has commented out, and reads the live one', () => {
		const { tsconfigPath, text } = setupConfig({
			body: `{
	"compilerOptions": {
		/*
		 * the aliases this package used to declare:
		 * "paths": { "@old/*": ["./legacy/*"] }
		 */
		"paths": { "@/*": ["./src/*"] }
	}
}`,
		});

		const aliases = readPathAliases({ tsconfigPath, text });

		expect(aliases?.patterns).toStrictEqual(new Map([['@/*', ['./src/*']]]));
	});

	test.each([
		{ shape: 'a line comment with no newline after it', tail: '// generated by the workspace script' },
		{ shape: 'a block comment that is never closed', tail: '/* cut off here' },
	])('reads a config ending in $shape', ({ tail }) => {
		const { tsconfigPath, text } = setupConfig({ body: `{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } } ${tail}` });

		const aliases = readPathAliases({ tsconfigPath, text });

		expect(aliases).toStrictEqual({ base: 'packages/engine', patterns: new Map([['@/*', ['./src/*']]]) });
	});

	test('a brace inside a target does not end the paths block early, so the alias survives it', () => {
		const { tsconfigPath, text } = setupConfig({ body: '{ "compilerOptions": { "paths": { "@/*": ["./src/{shared}/*"] } } }' });

		const aliases = readPathAliases({ tsconfigPath, text });

		expect(aliases?.patterns).toStrictEqual(new Map([['@/*', ['./src/{shared}/*']]]));
	});

	test('a paths block whose braces never close reads as no aliases rather than throwing', () => {
		// a tsconfig cut off mid-write: the block is opened and the file ends
		// inside it, so there is no block to read
		const { tsconfigPath, text } = setupConfig({ body: '{ "compilerOptions": { "paths": { "@/*": { "types": ["./src/*"] }' });

		const aliases = readPathAliases({ tsconfigPath, text });

		expect(aliases).toStrictEqual({ base: 'packages/engine', patterns: new Map() });
	});
});
