import { describe, expect, test } from '@jest/globals';
import { setupCloneSpansInput, setupFileListInput } from '@lightsout/standards-testkit';
import { check } from './check.ts';

describe('duplicate-code-block check', () => {
	test('asks for the spans the engine detected, since the detector runs once for the whole repo', () => {
		expect(check.inputKind).toBe('clone-spans');
	});

	test('reports one duplicated block as a finding naming both sides and how long the copy is', async () => {
		const input = setupCloneSpansInput({
			spans: [
				{
					files: [
						{ path: 'src/a/alpha.ts', startLine: 10, endLine: 24 },
						{ path: 'src/b/beta.ts', startLine: 3, endLine: 17 },
					],
					tokens: 120,
				},
			],
		});

		const findings = await check.run({ input, settings: { minTokens: 50 } });

		expect(findings).toStrictEqual([
			{
				siteKey: 'duplicate-code-block:src/a/alpha.ts|src/b/beta.ts',
				files: [
					{ path: 'src/a/alpha.ts', startLine: 10, endLine: 24 },
					{ path: 'src/b/beta.ts', startLine: 3, endLine: 17 },
				],
				detail: '1 duplicated block(s), the longest 15 lines',
				guidance: 'The same code is written out in both files. Extract the shared block, or say why the copies have to differ.',
			},
		]);
	});

	test('a second copy between the same two files joins the finding they already have, and the longest span is the one reported', async () => {
		const input = setupCloneSpansInput({
			spans: [
				{
					files: [
						{ path: 'src/a/alpha.ts', startLine: 10, endLine: 14 },
						{ path: 'src/b/beta.ts', startLine: 3, endLine: 7 },
					],
					tokens: 60,
				},
				{
					files: [
						{ path: 'src/a/alpha.ts', startLine: 40, endLine: 59 },
						{ path: 'src/b/beta.ts', startLine: 30, endLine: 49 },
					],
					tokens: 180,
				},
			],
		});

		const findings = await check.run({ input, settings: { minTokens: 50 } });

		expect(findings).toStrictEqual([
			{
				siteKey: 'duplicate-code-block:src/a/alpha.ts|src/b/beta.ts',
				files: [
					{ path: 'src/a/alpha.ts', startLine: 10, endLine: 14 },
					{ path: 'src/b/beta.ts', startLine: 3, endLine: 7 },
					{ path: 'src/a/alpha.ts', startLine: 40, endLine: 59 },
					{ path: 'src/b/beta.ts', startLine: 30, endLine: 49 },
				],
				detail: '2 duplicated block(s), the longest 20 lines',
				guidance: 'The same code is written out in both files. Extract the shared block, or say why the copies have to differ.',
			},
		]);
	});

	test('a shorter copy found after a longer one leaves the reported length at the longer one', async () => {
		const input = setupCloneSpansInput({
			spans: [
				{
					files: [
						{ path: 'src/a/alpha.ts', startLine: 10, endLine: 39 },
						{ path: 'src/b/beta.ts', startLine: 3, endLine: 32 },
					],
					tokens: 240,
				},
				{
					files: [
						{ path: 'src/a/alpha.ts', startLine: 60, endLine: 64 },
						{ path: 'src/b/beta.ts', startLine: 50, endLine: 54 },
					],
					tokens: 60,
				},
			],
		});

		const findings = await check.run({ input, settings: { minTokens: 50 } });

		expect(findings[0]?.detail).toBe('2 duplicated block(s), the longest 30 lines');
	});

	test('a span whose two sides differ in length is measured by the longer one', async () => {
		const input = setupCloneSpansInput({
			spans: [
				{
					files: [
						{ path: 'src/a/alpha.ts', startLine: 10, endLine: 15 },
						{ path: 'src/b/beta.ts', startLine: 3, endLine: 11 },
					],
					tokens: 70,
				},
			],
		});

		const findings = await check.run({ input, settings: { minTokens: 50 } });

		expect(findings[0]?.detail).toBe('1 duplicated block(s), the longest 9 lines');
	});

	test('the same pair reported with its sides the other way round is still one finding', async () => {
		const input = setupCloneSpansInput({
			spans: [
				{
					files: [
						{ path: 'src/a/alpha.ts', startLine: 10, endLine: 14 },
						{ path: 'src/b/beta.ts', startLine: 3, endLine: 7 },
					],
					tokens: 60,
				},
				{
					files: [
						{ path: 'src/b/beta.ts', startLine: 30, endLine: 34 },
						{ path: 'src/a/alpha.ts', startLine: 40, endLine: 44 },
					],
					tokens: 60,
				},
			],
		});

		const findings = await check.run({ input, settings: { minTokens: 50 } });

		expect(findings.map(({ siteKey, files }) => ({ siteKey, sites: files.length }))).toStrictEqual([
			{ siteKey: 'duplicate-code-block:src/a/alpha.ts|src/b/beta.ts', sites: 4 },
		]);
	});

	test('copies between different pairs of files are separate findings, one per pair', async () => {
		const input = setupCloneSpansInput({
			spans: [
				{
					files: [
						{ path: 'src/a/alpha.ts', startLine: 10, endLine: 14 },
						{ path: 'src/b/beta.ts', startLine: 3, endLine: 7 },
					],
					tokens: 60,
				},
				{
					files: [
						{ path: 'src/a/alpha.ts', startLine: 40, endLine: 44 },
						{ path: 'src/c/gamma.ts', startLine: 8, endLine: 12 },
					],
					tokens: 60,
				},
			],
		});

		const findings = await check.run({ input, settings: { minTokens: 50 } });

		expect(findings.map(({ siteKey }) => siteKey)).toStrictEqual([
			'duplicate-code-block:src/a/alpha.ts|src/b/beta.ts',
			'duplicate-code-block:src/a/alpha.ts|src/c/gamma.ts',
		]);
	});

	test('a repo the detector found no copy in earns no finding', async () => {
		const input = setupCloneSpansInput({ spans: [] });

		const findings = await check.run({ input, settings: { minTokens: 50 } });

		expect(findings).toStrictEqual([]);
	});

	test('reports nothing for an input of any other kind rather than refusing', async () => {
		const findings = await check.run({ input: setupFileListInput({ files: ['src/a/alpha.ts'] }), settings: { minTokens: 50 } });

		expect(findings).toStrictEqual([]);
	});
});
