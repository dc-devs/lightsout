import { describe, expect, test } from '@jest/globals';
import { readPackageImports } from './readPackageImports.ts';

const setupManifest = ({ body, manifestPath = 'packages/engine/package.json' }: { body: string; manifestPath?: string }) => ({ manifestPath, text: body });

describe('readPackageImports', () => {
	test('maps each alias pattern to the targets it names', () => {
		const { manifestPath, text } = setupManifest({ body: '{ "imports": { "#src/*": "./src/*", "#tests/*": "./tests/*" } }' });

		const aliases = readPackageImports({ manifestPath, text });

		expect(aliases?.patterns).toStrictEqual(
			new Map([
				['#src/*', ['./src/*']],
				['#tests/*', ['./tests/*']],
			]),
		);
	});

	test('anchors the targets to the folder holding the manifest, which is what resolves them', () => {
		const { manifestPath, text } = setupManifest({ body: '{ "imports": { "#src/*": "./src/*" } }' });

		const aliases = readPackageImports({ manifestPath, text });

		expect(aliases?.base).toBe('packages/engine');
	});

	test('anchors to the repo root for a manifest that sits there', () => {
		const { manifestPath, text } = setupManifest({ body: '{ "imports": { "#src/*": "./src/*" } }', manifestPath: 'package.json' });

		const aliases = readPackageImports({ manifestPath, text });

		expect(aliases?.base).toBe('.');
	});

	test('keeps every target of an alias that names more than one, in declaration order', () => {
		const { manifestPath, text } = setupManifest({ body: '{ "imports": { "#src/*": ["./src/*", "./generated/*"] } }' });

		const aliases = readPackageImports({ manifestPath, text });

		expect(aliases?.patterns.get('#src/*')).toStrictEqual(['./src/*', './generated/*']);
	});

	test('takes the default branch of a conditional target, which is what a bundler resolves', () => {
		const { manifestPath, text } = setupManifest({ body: '{ "imports": { "#src/*": { "node": "./node/*", "default": "./src/*" } } }' });

		const aliases = readPackageImports({ manifestPath, text });

		expect(aliases?.patterns).toStrictEqual(new Map([['#src/*', ['./src/*']]]));
	});

	test('leaves out a conditional target that names no default, since no unconditional target exists to resolve against', () => {
		const { manifestPath, text } = setupManifest({ body: '{ "imports": { "#src/*": { "node": "./node/*" }, "#tests/*": "./tests/*" } }' });

		const aliases = readPackageImports({ manifestPath, text });

		expect(aliases?.patterns).toStrictEqual(new Map([['#tests/*', ['./tests/*']]]));
	});

	test('leaves out a target that is neither a path, a list of them, nor a conditional object', () => {
		const { manifestPath, text } = setupManifest({ body: '{ "imports": { "#src/*": null, "#tests/*": "./tests/*" } }' });

		const aliases = readPackageImports({ manifestPath, text });

		expect(aliases?.patterns).toStrictEqual(new Map([['#tests/*', ['./tests/*']]]));
	});

	test('answers undefined for a manifest that declares no imports, so the tsconfig beside it still gets asked', () => {
		const { manifestPath, text } = setupManifest({ body: '{ "name": "@lightsout/engine", "type": "module" }' });

		// not an empty map: a manifest without the field says nothing about the
		// package's aliases, and a confident "none" would make every aliased
		// import in it read as a published package
		const aliases = readPackageImports({ manifestPath, text });

		expect(aliases).toBeUndefined();
	});

	test('answers undefined for text that is not valid JSON, which is the same "I cannot tell"', () => {
		const { manifestPath, text } = setupManifest({ body: '{ "imports": { "#src/*": ' });

		const aliases = readPackageImports({ manifestPath, text });

		expect(aliases).toBeUndefined();
	});

	test('answers undefined when imports is not an object at all', () => {
		const { manifestPath, text } = setupManifest({ body: '{ "imports": "./src/*" }' });

		const aliases = readPackageImports({ manifestPath, text });

		expect(aliases).toBeUndefined();
	});

	test('an imports block holding nothing is a real answer of no aliases', () => {
		const { manifestPath, text } = setupManifest({ body: '{ "imports": {} }' });

		const aliases = readPackageImports({ manifestPath, text });

		expect(aliases).toStrictEqual({ base: 'packages/engine', patterns: new Map() });
	});
});
