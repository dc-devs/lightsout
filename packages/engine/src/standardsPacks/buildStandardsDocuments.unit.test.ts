import { describe, expect, test } from '@jest/globals';
import { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import { StandardsSeverity } from '#src/contracts/standardsCheck/StandardsSeverity.ts';
import { buildStandardsDocuments } from '#src/standardsPacks/buildStandardsDocuments.ts';
import type { LoadedStandardsDocument } from '#src/standardsPacks/common/types/LoadedStandardsDocument.ts';
import type { LoadedStandardsPack } from '#src/standardsPacks/common/types/LoadedStandardsPack.ts';
import type { LoadedStandardsRule } from '#src/standardsPacks/common/types/LoadedStandardsRule.ts';

const buildRule = ({
	id,
	prose,
	channel = 'base',
	defaultSeverity = StandardsSeverity.Advisory,
}: {
	id: string;
	prose: string;
	channel?: string;
	defaultSeverity?: StandardsSeverity;
}): LoadedStandardsRule => ({
	id,
	set: 'code',
	documentPath: 'code/example',
	summary: `${id} summary`,
	prose,
	channel,
	checked: false,
	defaultSeverity,
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

/** A pack with a base and a react code document, plus one tests document. */
const setupPack = (): LoadedStandardsPack => ({
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

/** A pack whose one document holds an ordinary rule and a rule it ships off, for repos to opt into. */
const setupOptInPack = (): LoadedStandardsPack => ({
	...setupPack(),
	documents: [buildDocument({ path: 'code/modules', intro: '# Modules', ruleIds: ['graduation', 'internal-import'] })],
	rules: [
		buildRule({ id: 'graduation', prose: 'A concept earns its folder.' }),
		buildRule({ id: 'internal-import', prose: 'Private files live in internal/.', defaultSeverity: StandardsSeverity.Off }),
	],
});

/** A config whose `standards-checks` names one rule at one severity. */
const buildConfig = ({ rule = 'internal-import', severity }: { rule?: string; severity: StandardsSeverity }) =>
	LightsoutConfig.parse({ gates: { check: 'true', test: 'true', 'test-coverage': false, build: 'true' }, 'standards-checks': { [rule]: severity } });

describe('buildStandardsDocuments', () => {
	test('assembles each document as a header, its intro, then its rule prose in order', () => {
		const pack = setupPack();

		const { code, tests } = buildStandardsDocuments({ pack, channels: [], config: undefined });

		// the header names the pack and the document folder it came from
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
		const pack = setupPack();

		const { code } = buildStandardsDocuments({ pack, channels: ['tanstack', 'react'], config: undefined });
		const paths = (code ?? '').split('\n').filter((line) => line.startsWith('<!--'));

		// base documents first in path order, then each active channel in the order given
		expect(paths).toStrictEqual([
			'<!-- lightsout defaults: code/architecture -->',
			'<!-- lightsout defaults: code/style/patterns -->',
			'<!-- lightsout defaults: code/frameworks/tanstack -->',
			'<!-- lightsout defaults: code/frameworks/react -->',
		]);
		// an inactive channel's prose is not injected at all
		expect(buildStandardsDocuments({ pack, channels: ['react'], config: undefined }).code).not.toContain('Routes are file-based.');
	});

	test('leaves a set out entirely when no document is in play for it', () => {
		const pack = setupPack();
		const codeOnly: LoadedStandardsPack = { ...pack, documents: pack.documents.filter((document) => document.set === 'code') };

		const assembled = buildStandardsDocuments({ pack: codeOnly, channels: [], config: undefined });

		// absent, not an empty string — nothing to inline is not the same as inlining nothing
		expect(assembled.tests).toBe(undefined);
		expect('tests' in assembled).toBeFalsy();
	});

	test('leaves the code set out when only the tests set has a document in play', () => {
		const pack = setupPack();
		const testsOnly: LoadedStandardsPack = { ...pack, documents: pack.documents.filter((document) => document.set === 'tests') };

		const assembled = buildStandardsDocuments({ pack: testsOnly, channels: [], config: undefined });

		expect(assembled.code).toBe(undefined);
		expect('code' in assembled).toBeFalsy();
		expect(assembled.tests).toBe('<!-- lightsout defaults: tests/unit-testing -->\n# Unit Testing\n\nMocks carry a mock prefix.');
	});

	test('sorts documents by path and keeps two documents sharing a path in the order given', () => {
		const pack = setupPack();
		const scrambled: LoadedStandardsPack = {
			...pack,
			documents: [
				buildDocument({ path: 'code/b', intro: '# B', ruleIds: ['functions'] }),
				buildDocument({ path: 'code/a', intro: '# A', ruleIds: ['classes'] }),
				buildDocument({ path: 'code/b', intro: '# B again', ruleIds: ['graduation'] }),
			],
		};

		const { code } = buildStandardsDocuments({ pack: scrambled, channels: [], config: undefined });

		// 'code/a' moves ahead of both 'code/b' documents; the tied pair holds its original order
		expect(code).toBe(
			'<!-- lightsout defaults: code/a -->\n# A\n\nDefault to functions.\n\n<!-- lightsout defaults: code/b -->\n# B\n\nUse arrow functions.\n\n<!-- lightsout defaults: code/b -->\n# B again\n\nA concept earns its folder.',
		);
	});

	test('skips a rule id the pack has no rule for rather than leaving a gap', () => {
		const pack = setupPack();
		const dangling: LoadedStandardsPack = {
			...pack,
			documents: [buildDocument({ path: 'code/dangling', intro: '# Dangling', ruleIds: ['missing', 'graduation'] })],
		};

		const { code } = buildStandardsDocuments({ pack: dangling, channels: [], config: undefined });

		// the unknown id contributes nothing — no blank line, no placeholder
		expect(code).toBe('<!-- lightsout defaults: code/dangling -->\n# Dangling\n\nA concept earns its folder.');
	});

	test('drops empty prose rather than opening a document with blank lines', () => {
		const pack = setupPack();
		const sparse: LoadedStandardsPack = {
			...pack,
			documents: [buildDocument({ path: 'code/sparse', intro: '', ruleIds: ['blank', 'graduation'] })],
			rules: [buildRule({ id: 'blank', prose: '' }), buildRule({ id: 'graduation', prose: 'A concept earns its folder.' })],
		};

		const { code } = buildStandardsDocuments({ pack: sparse, channels: [], config: undefined });

		// an intro-less document starts at its first rule, with no leading blank line
		expect(code).toBe('<!-- lightsout defaults: code/sparse -->\nA concept earns its folder.');
	});

	test("leaves out an opt-in rule's prose while the repo's config never names it", () => {
		const pack = setupOptInPack();

		const { code } = buildStandardsDocuments({ pack, channels: [], config: undefined });

		expect(code).toBe('<!-- lightsout defaults: code/modules -->\n# Modules\n\nA concept earns its folder.');
	});

	test('includes an opt-in rule once the repo names it, at any severity', () => {
		const pack = setupOptInPack();

		const optedIn = buildStandardsDocuments({ pack, channels: [], config: buildConfig({ severity: StandardsSeverity.Blocking }) });
		// off from the repo means its own linter enforces the rule: the standard still holds
		const lintedElsewhere = buildStandardsDocuments({ pack, channels: [], config: buildConfig({ severity: StandardsSeverity.Off }) });

		expect(optedIn.code).toContain('Private files live in internal/.');
		expect(lintedElsewhere.code).toContain('Private files live in internal/.');
	});

	test('keeps the prose of a rule the repo turned off, when the pack ships it on', () => {
		const pack = setupPack();

		const { code } = buildStandardsDocuments({ pack, channels: [], config: buildConfig({ rule: 'graduation', severity: StandardsSeverity.Off }) });

		expect(code).toContain('A concept earns its folder.');
	});
});
