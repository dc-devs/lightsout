import { describe, expect, test } from '@jest/globals';
import type { LoadedStandardsDocument, LoadedStandardsPackage, LoadedStandardsRule } from '@/standardsPackages';
import { buildStandardsDocuments } from '@/standardsPackages';

const buildRule = ({ id, prose, channel = 'base' }: { id: string; prose: string; channel?: string }): LoadedStandardsRule => ({
	id,
	set: 'code',
	documentPath: 'code/example',
	summary: `${id} summary`,
	prose,
	channel,
	checked: false,
	defaultSeverity: 'advisory',
	defaultSettings: {},
	fixturesPath: `/pkg/code/example/${id}/fixtures`,
});

const buildDocument = ({
	path,
	intro,
	ruleIds,
	set = 'code',
	channel = 'base',
}: {
	path: string;
	intro: string;
	ruleIds: string[];
	set?: LoadedStandardsDocument['set'];
	channel?: string;
}): LoadedStandardsDocument => ({ set, path, channel, intro, ruleIds });

/** A package with a base and a react code document, plus one tests document. */
const setupPackage = (): LoadedStandardsPackage => ({
	name: 'lightsout defaults',
	formatVersion: 1,
	rootPath: '/pkg',
	documents: [
		buildDocument({ path: 'code/style/patterns', intro: '# Patterns', ruleIds: ['functions', 'classes'] }),
		buildDocument({ path: 'code/architecture', intro: '# Architecture', ruleIds: ['graduation'] }),
		buildDocument({ path: 'code/frameworks/react', intro: '# React', ruleIds: ['hooks'], channel: 'react' }),
		buildDocument({ path: 'code/frameworks/tanstack', intro: '# TanStack', ruleIds: ['routes'], channel: 'tanstack' }),
		buildDocument({ path: 'tests/unit-testing', intro: '# Unit Testing', ruleIds: ['mock-prefix'], set: 'tests' }),
	],
	rules: [
		buildRule({ id: 'functions', prose: 'Use arrow functions.' }),
		buildRule({ id: 'classes', prose: 'Default to functions.' }),
		buildRule({ id: 'graduation', prose: 'A concept earns its folder.' }),
		buildRule({ id: 'hooks', prose: 'Hooks obey the rules of hooks.', channel: 'react' }),
		buildRule({ id: 'routes', prose: 'Routes are file-based.', channel: 'tanstack' }),
		buildRule({ id: 'mock-prefix', prose: 'Mocks carry a mock prefix.' }),
	],
});

describe('buildStandardsDocuments', () => {
	test('assembles each document as a header, its intro, then its rule prose in order', () => {
		const pkg = setupPackage();

		const { code, tests } = buildStandardsDocuments({ pkg, channels: [] });

		// the header names the package and the document folder it came from
		expect(code).toContain('<!-- lightsout defaults: code/architecture -->\n# Architecture\n\nA concept earns its folder.');
		// rule prose follows the intro in ruleIds order, joined by a blank line
		expect(code).toContain('<!-- lightsout defaults: code/style/patterns -->\n# Patterns\n\nUse arrow functions.\n\nDefault to functions.');
		// documents are joined the same way — a blank line between them
		expect(code).toBe(
			'<!-- lightsout defaults: code/architecture -->\n# Architecture\n\nA concept earns its folder.\n\n<!-- lightsout defaults: code/style/patterns -->\n# Patterns\n\nUse arrow functions.\n\nDefault to functions.',
		);
		// each set is assembled on its own
		expect(tests).toBe('<!-- lightsout defaults: tests/unit-testing -->\n# Unit Testing\n\nMocks carry a mock prefix.');
	});

	test('omits documents whose channel is not active, and orders active channels after the base ones', () => {
		const pkg = setupPackage();

		const { code } = buildStandardsDocuments({ pkg, channels: ['tanstack', 'react'] });
		const paths = (code ?? '').split('\n').filter((line) => line.startsWith('<!--'));

		// base documents first in path order, then each active channel in the order given
		expect(paths).toStrictEqual([
			'<!-- lightsout defaults: code/architecture -->',
			'<!-- lightsout defaults: code/style/patterns -->',
			'<!-- lightsout defaults: code/frameworks/tanstack -->',
			'<!-- lightsout defaults: code/frameworks/react -->',
		]);
		// an inactive channel's prose is not injected at all
		expect(buildStandardsDocuments({ pkg, channels: ['react'] }).code).not.toContain('Routes are file-based.');
	});

	test('leaves a set out entirely when no document is in play for it', () => {
		const pkg = setupPackage();
		const codeOnly: LoadedStandardsPackage = { ...pkg, documents: pkg.documents.filter((document) => document.set === 'code') };

		const assembled = buildStandardsDocuments({ pkg: codeOnly, channels: [] });

		// absent, not an empty string — nothing to inline is not the same as inlining nothing
		expect(assembled.tests).toBe(undefined);
		expect('tests' in assembled).toBeFalsy();
	});

	test('leaves the code set out when only the tests set has a document in play', () => {
		const pkg = setupPackage();
		const testsOnly: LoadedStandardsPackage = { ...pkg, documents: pkg.documents.filter((document) => document.set === 'tests') };

		const assembled = buildStandardsDocuments({ pkg: testsOnly, channels: [] });

		expect(assembled.code).toBe(undefined);
		expect('code' in assembled).toBeFalsy();
		expect(assembled.tests).toBe('<!-- lightsout defaults: tests/unit-testing -->\n# Unit Testing\n\nMocks carry a mock prefix.');
	});

	test('sorts documents by path and keeps two documents sharing a path in the order given', () => {
		const pkg = setupPackage();
		const scrambled: LoadedStandardsPackage = {
			...pkg,
			documents: [
				buildDocument({ path: 'code/b', intro: '# B', ruleIds: ['functions'] }),
				buildDocument({ path: 'code/a', intro: '# A', ruleIds: ['classes'] }),
				buildDocument({ path: 'code/b', intro: '# B again', ruleIds: ['graduation'] }),
			],
		};

		const { code } = buildStandardsDocuments({ pkg: scrambled, channels: [] });

		// 'code/a' moves ahead of both 'code/b' documents; the tied pair holds its original order
		expect(code).toBe(
			'<!-- lightsout defaults: code/a -->\n# A\n\nDefault to functions.\n\n<!-- lightsout defaults: code/b -->\n# B\n\nUse arrow functions.\n\n<!-- lightsout defaults: code/b -->\n# B again\n\nA concept earns its folder.',
		);
	});

	test('skips a rule id the package has no rule for rather than leaving a gap', () => {
		const pkg = setupPackage();
		const dangling: LoadedStandardsPackage = {
			...pkg,
			documents: [buildDocument({ path: 'code/dangling', intro: '# Dangling', ruleIds: ['missing', 'graduation'] })],
		};

		const { code } = buildStandardsDocuments({ pkg: dangling, channels: [] });

		// the unknown id contributes nothing — no blank line, no placeholder
		expect(code).toBe('<!-- lightsout defaults: code/dangling -->\n# Dangling\n\nA concept earns its folder.');
	});

	test('drops empty prose rather than opening a document with blank lines', () => {
		const pkg = setupPackage();
		const sparse: LoadedStandardsPackage = {
			...pkg,
			documents: [buildDocument({ path: 'code/sparse', intro: '', ruleIds: ['blank', 'graduation'] })],
			rules: [buildRule({ id: 'blank', prose: '' }), buildRule({ id: 'graduation', prose: 'A concept earns its folder.' })],
		};

		const { code } = buildStandardsDocuments({ pkg: sparse, channels: [] });

		// an intro-less document starts at its first rule, with no leading blank line
		expect(code).toBe('<!-- lightsout defaults: code/sparse -->\nA concept earns its folder.');
	});
});
