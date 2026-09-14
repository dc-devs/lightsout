import { describe, expect, test } from '@jest/globals';
import { extractSourceEvidence } from '#src/plan/evidence/extractSourceEvidence.ts';

// Runtime require rather than a static import: the CJS TypeScript compiler
// probes __filename at load, so it has to be required at runtime rather than
// pulled into the module graph. ts-jest transpiles this file to CommonJS, where
// `require` is already the local resolver — `import.meta` does not exist there.
const ts = require('typescript') as typeof import('typescript');

/**
 * One file's worth of input, with the consumer's compiler injected exactly as
 * the collector injects it. A test states the source text its criterion turns
 * on; the path only decides the script flavor.
 */
const setupSource = ({ lines, path = 'src/example.ts' }: { lines: string[]; path?: string }) => ({
	path,
	content: lines.join('\n'),
	compiler: ts,
});

describe('extractSourceEvidence', () => {
	test('extractSourceEvidence: exports keep their docblocks and imports survive, while an unreferenced private helper is dropped', () => {
		const source = setupSource({
			lines: [
				"import { readFile } from 'node:fs/promises';",
				"import { join } from 'node:path';",
				'',
				'/**',
				' * Reads the manifest a run wrote.',
				' */',
				"export const readManifest = async ({ path }: { path: string }) => readFile(path, 'utf8');",
				'',
				'const shoutingHelper = (value: string) => value.toUpperCase();',
			],
		});

		const evidence = extractSourceEvidence(source);

		expect(evidence.text).toContain("import { readFile } from 'node:fs/promises';");
		expect(evidence.text).toContain("import { join } from 'node:path';");
		// the docblock is the export's stated contract — losing it to size
		// reduction would hand a writer a signature with no meaning attached
		expect(evidence.text).toContain('Reads the manifest a run wrote.');
		expect(evidence.text).toContain('export const readManifest');
		expect(evidence.text).not.toContain('shoutingHelper');
		expect(evidence.definitions).toStrictEqual(['readManifest']);
	});

	test('extractSourceEvidence: a private helper and a Params interface a kept export references are kept with it', () => {
		const source = setupSource({
			lines: [
				'interface Params {',
				'\tsource: string;',
				'}',
				'',
				'const normalizeSource = ({ source }: Params) => source.trim();',
				'',
				'export const buildLabel = ({ source }: Params) => normalizeSource({ source });',
			],
		});

		const evidence = extractSourceEvidence(source);

		expect(evidence.text).toContain('export const buildLabel');
		// a kept export that names something the evidence does not show reads as
		// a broken reference to whoever is handed it
		expect(evidence.text).toContain('const normalizeSource');
		expect(evidence.text).toContain('interface Params');
	});

	test('extractSourceEvidence: a tsx file keeps an export statement and the declarations it publishes', () => {
		const source = setupSource({
			path: 'src/Widget.tsx',
			lines: [
				"import type { ReactNode } from 'react';",
				'',
				'type WidgetProps = { label: string };',
				'',
				'function renderWidget({ label }: WidgetProps): ReactNode {',
				'\treturn <span>{label}</span>;',
				'}',
				'',
				'export { renderWidget };',
			],
		});

		const evidence = extractSourceEvidence(source);

		// a tsx path is parsed as TSX, so the JSX body is a declaration rather than a
		// parse error; and a name published by a separate export statement is reached
		// through that statement, not through a modifier it does not carry
		expect(evidence.text).toContain('export { renderWidget };');
		expect(evidence.text).toContain('function renderWidget');
		expect(evidence.text).toContain('type WidgetProps');
		expect(evidence.definitions).toStrictEqual(['WidgetProps', 'renderWidget']);
	});

	test('extractSourceEvidence: content with no top-level statements comes back whole rather than empty', () => {
		const source = setupSource({
			lines: ['// a header line and nothing else', '/* this file declares nothing at all */', ''],
		});

		const evidence = extractSourceEvidence(source);

		expect(evidence.text).toBe(source.content);
		expect(evidence.definitions).toStrictEqual([]);
	});

	test('extractSourceEvidence: the reported definitions are exactly the declarations the kept text holds', () => {
		const source = setupSource({
			lines: [
				"import { join } from 'node:path';",
				'',
				'const buildKey = (value: string) => value.trim();',
				'',
				'export const firstExport = (value: string) => buildKey(value);',
				'',
				"export const secondExport = (value: string) => join('a', value);",
				'',
				'export interface ThirdExport {',
				'\tvalue: string;',
				'}',
			],
		});

		const evidence = extractSourceEvidence(source);

		expect(evidence.definitions).toStrictEqual(['buildKey', 'firstExport', 'secondExport', 'ThirdExport']);
		// every name the brief claims has to be readable in the text it ships with
		expect(evidence.definitions.every((name) => evidence.text.includes(name))).toBe(true);
	});
});
