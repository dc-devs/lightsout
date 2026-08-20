import { describe, expect, test } from '@jest/globals';
import { StandardsSeverity } from '#src/contracts/index.ts';
import type { Driver, DriverInvocation, DriverResult } from '#src/drivers/index.ts';
import { runStandardsReview } from '#src/standardsCheck/index.ts';
import type { LoadedStandardsPackage, LoadedStandardsRule } from '#src/standardsPackages/index.ts';

const rule = (overrides: Partial<LoadedStandardsRule> & { id: string }): LoadedStandardsRule => ({
	set: 'code',
	documentPath: 'code/architecture/folder-structure',
	summary: 'a rule',
	prose: 'the argument for the rule',
	channel: 'base',
	checked: false,
	defaultSeverity: StandardsSeverity.Advisory,
	defaultSettings: {},
	fixturesPath: `/packages/acme/${overrides.id}/fixtures`,
	...overrides,
});

const packageOf = ({ rules }: { rules: LoadedStandardsRule[] }): LoadedStandardsPackage => ({
	name: 'acme',
	formatVersion: 1,
	rootPath: '/packages/acme',
	documents: [],
	rules,
});

/** A stub harness answering every invocation with `text`, recording the prompts and the full invocations it was given. */
const setupDriver = ({ result }: { result: DriverResult | (() => DriverResult) }) => {
	const prompts: string[] = [];
	const invocations: DriverInvocation[] = [];
	const driver: Driver = {
		name: 'stub',
		invoke: async (invocation) => {
			prompts.push(invocation.prompt);
			invocations.push(invocation);

			return typeof result === 'function' ? result() : result;
		},
	};

	return { driver, prompts, invocations };
};

const reviewText = (findings: Record<string, unknown>[]) => JSON.stringify({ findings });

describe('runStandardsReview', () => {
	test('a reported violation becomes an advisory finding with an engine-derived site key', async () => {
		const { driver } = setupDriver({
			result: {
				text: reviewText([
					{ rule: 'common-placement', files: [{ path: 'src/a.ts', startLine: 4 }], detail: 'promoted on one consumer', guidance: 'move it back' },
				]),
				exitCode: 0,
			},
		});

		const { findings, notes } = await runStandardsReview({
			cwd: '/repo',
			driver,
			packages: [packageOf({ rules: [rule({ id: 'common-placement' })] })],
			channels: [],
			files: ['src/a.ts'],
		});

		expect(notes).toStrictEqual([]);
		expect(findings).toStrictEqual([
			{
				rule: 'common-placement',
				severity: StandardsSeverity.Advisory,
				siteKey: 'common-placement:src/a.ts',
				files: [{ path: 'src/a.ts', startLine: 4 }],
				detail: 'promoted on one consumer',
				guidance: 'move it back',
			},
		]);
	});

	test('a review finding is never blocking, however the agent phrased it', async () => {
		const { driver } = setupDriver({
			result: { text: reviewText([{ rule: 'common-placement', severity: 'blocking', files: [{ path: 'src/a.ts' }], detail: 'MUST FIX' }]), exitCode: 0 },
		});

		const { findings } = await runStandardsReview({
			cwd: '/repo',
			driver,
			packages: [packageOf({ rules: [rule({ id: 'common-placement' })] })],
			channels: [],
			files: ['src/a.ts'],
		});

		// severity is the engine's to stamp — an agent cannot promote its own opinion into work
		expect(findings[0]?.severity).toBe(StandardsSeverity.Advisory);
	});

	test('a finding naming a rule no package declares is dropped, and the drop is stated', async () => {
		const { driver } = setupDriver({
			result: {
				text: reviewText([
					{ rule: 'invented-rule', files: [{ path: 'src/a.ts' }], detail: 'made up' },
					{ rule: 'common-placement', files: [{ path: 'src/b.ts' }], detail: 'real' },
				]),
				exitCode: 0,
			},
		});

		const { findings, notes } = await runStandardsReview({
			cwd: '/repo',
			driver,
			packages: [packageOf({ rules: [rule({ id: 'common-placement' })] })],
			channels: [],
			files: ['src/a.ts', 'src/b.ts'],
		});

		expect(findings.map((finding) => finding.rule)).toStrictEqual(['common-placement']);
		expect(notes).toStrictEqual(['agent review: 1 finding(s) dropped — no judgment rule is named invented-rule']);
	});

	test('a finding with no file to point at is dropped — a site key needs a site', async () => {
		const { driver } = setupDriver({ result: { text: reviewText([{ rule: 'common-placement', files: [], detail: 'somewhere in the repo' }]), exitCode: 0 } });

		const { findings, notes } = await runStandardsReview({
			cwd: '/repo',
			driver,
			packages: [packageOf({ rules: [rule({ id: 'common-placement' })] })],
			channels: [],
			files: ['src/a.ts'],
		});

		expect(findings).toStrictEqual([]);
		expect(notes).toStrictEqual(['agent review: 1 finding(s) dropped — reported with no file to point at']);
	});

	test('a harness that cannot answer is a skipped review, not a failure', async () => {
		const { driver } = setupDriver({ result: { text: 'prose, not a report', exitCode: 0 } });

		const { findings, notes } = await runStandardsReview({
			cwd: '/repo',
			driver,
			packages: [packageOf({ rules: [rule({ id: 'common-placement' })] })],
			channels: [],
			files: ['src/a.ts'],
		});

		// the machine half is real evidence and must still be reported
		expect(findings).toStrictEqual([]);
		expect(notes[0]?.startsWith('agent review skipped — ')).toBe(true);
	});

	test('a rate-limited harness is skipped the same way, and never throws', async () => {
		const { driver } = setupDriver({ result: { text: '', exitCode: 1, rateLimited: true } });

		const { notes } = await runStandardsReview({
			cwd: '/repo',
			driver,
			packages: [packageOf({ rules: [rule({ id: 'common-placement' })] })],
			channels: [],
			files: ['src/a.ts'],
		});

		expect(notes).toStrictEqual(['agent review skipped — harness rate limited or overloaded']);
	});

	test('no judgment rules means no agent is spent saying so', async () => {
		const { driver, prompts } = setupDriver({ result: { text: reviewText([]), exitCode: 0 } });

		const { findings, notes } = await runStandardsReview({
			cwd: '/repo',
			driver,
			packages: [packageOf({ rules: [rule({ id: 'multi-export', checked: true })] })],
			channels: [],
			files: ['src/a.ts'],
		});

		expect(prompts).toStrictEqual([]);
		expect(findings).toStrictEqual([]);
		expect(notes).toStrictEqual([]);
	});

	test('no files in scope means no agent is spent either', async () => {
		const { driver, prompts } = setupDriver({ result: { text: reviewText([]), exitCode: 0 } });

		await runStandardsReview({
			cwd: '/repo',
			driver,
			packages: [packageOf({ rules: [rule({ id: 'common-placement' })] })],
			channels: [],
			files: [],
		});

		expect(prompts).toStrictEqual([]);
	});

	test('a rule on an inactive channel is not reviewed — an out-of-play document contributes nothing', async () => {
		const { driver, prompts } = setupDriver({ result: { text: reviewText([]), exitCode: 0 } });

		await runStandardsReview({
			cwd: '/repo',
			driver,
			packages: [packageOf({ rules: [rule({ id: 'react-hook-order', channel: 'react' })] })],
			channels: [],
			files: ['src/a.ts'],
		});

		expect(prompts).toStrictEqual([]);
	});

	test('a rule on an active channel is reviewed alongside the base rules', async () => {
		const { driver, prompts } = setupDriver({ result: { text: reviewText([]), exitCode: 0 } });

		await runStandardsReview({
			cwd: '/repo',
			driver,
			packages: [packageOf({ rules: [rule({ id: 'react-hook-order', channel: 'react' }), rule({ id: 'common-placement' })] })],
			channels: ['react'],
			files: ['src/a.ts'],
		});

		expect(prompts.length).toBe(1);
		expect(prompts[0]).toContain('- src/a.ts');
	});

	test('a finding the agent gave no guidance for carries none — the key is absent, not empty', async () => {
		const { driver } = setupDriver({
			result: { text: reviewText([{ rule: 'common-placement', files: [{ path: 'src/a.ts' }], detail: 'promoted on one consumer' }]), exitCode: 0 },
		});

		const { findings } = await runStandardsReview({
			cwd: '/repo',
			driver,
			packages: [packageOf({ rules: [rule({ id: 'common-placement' })] })],
			channels: [],
			files: ['src/a.ts'],
		});

		expect(findings[0]).toStrictEqual({
			rule: 'common-placement',
			severity: StandardsSeverity.Advisory,
			siteKey: 'common-placement:src/a.ts',
			files: [{ path: 'src/a.ts' }],
			detail: 'promoted on one consumer',
		});
	});

	test('a review that finds nothing reports nothing — the agent still ran', async () => {
		const { driver, prompts } = setupDriver({ result: { text: reviewText([]), exitCode: 0 } });

		const { findings, notes } = await runStandardsReview({
			cwd: '/repo',
			driver,
			packages: [packageOf({ rules: [rule({ id: 'common-placement' })] })],
			channels: [],
			files: ['src/a.ts'],
		});

		expect({ findings, notes, spawned: prompts.length }).toStrictEqual({ findings: [], notes: [], spawned: 1 });
	});

	test('repeated invented rule ids are counted every time but named once, in order', async () => {
		const { driver } = setupDriver({
			result: {
				text: reviewText([
					{ rule: 'zeta-rule', files: [{ path: 'src/a.ts' }], detail: 'made up' },
					{ rule: 'alpha-rule', files: [{ path: 'src/b.ts' }], detail: 'also made up' },
					{ rule: 'zeta-rule', files: [{ path: 'src/c.ts' }], detail: 'made up again' },
				]),
				exitCode: 0,
			},
		});

		const { findings, notes } = await runStandardsReview({
			cwd: '/repo',
			driver,
			packages: [packageOf({ rules: [rule({ id: 'common-placement' })] })],
			channels: [],
			files: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
		});

		expect(findings).toStrictEqual([]);
		expect(notes).toStrictEqual(['agent review: 3 finding(s) dropped — no judgment rule is named alpha-rule, zeta-rule']);
	});

	test('both kinds of drop are stated separately when one review does both', async () => {
		const { driver } = setupDriver({
			result: {
				text: reviewText([
					{ rule: 'invented-rule', files: [{ path: 'src/a.ts' }], detail: 'made up' },
					{ rule: 'common-placement', files: [], detail: 'somewhere in the repo' },
					{ rule: 'common-placement', files: [{ path: 'src/b.ts' }], detail: 'real' },
				]),
				exitCode: 0,
			},
		});

		const { findings, notes } = await runStandardsReview({
			cwd: '/repo',
			driver,
			packages: [packageOf({ rules: [rule({ id: 'common-placement' })] })],
			channels: [],
			files: ['src/a.ts', 'src/b.ts'],
		});

		expect(findings.map((finding) => finding.siteKey)).toStrictEqual(['common-placement:src/b.ts']);
		expect(notes).toStrictEqual([
			'agent review: 1 finding(s) dropped — no judgment rule is named invented-rule',
			'agent review: 1 finding(s) dropped — reported with no file to point at',
		]);
	});

	test('judgment rules from every loaded package are put in front of the reviewer', async () => {
		const { driver, invocations } = setupDriver({ result: { text: reviewText([]), exitCode: 0 } });

		await runStandardsReview({
			cwd: '/repo',
			driver,
			packages: [packageOf({ rules: [rule({ id: 'common-placement' })] }), packageOf({ rules: [rule({ id: 'one-export' })] })],
			channels: [],
			files: ['src/a.ts'],
		});

		expect(invocations[0]?.systemPrompt).toContain('common-placement');
		expect(invocations[0]?.systemPrompt).toContain('one-export');
	});

	test('the review reads the target repo read-only, under the timeout the caller set', async () => {
		const { driver, invocations } = setupDriver({ result: { text: reviewText([]), exitCode: 0 } });

		await runStandardsReview({
			cwd: '/repo',
			driver,
			packages: [packageOf({ rules: [rule({ id: 'common-placement' })] })],
			channels: [],
			files: ['src/a.ts'],
			timeoutMs: 90_000,
		});

		// nothing a judgment call concludes may edit the repo it is reading
		expect(invocations[0]).toEqual(expect.objectContaining({ cwd: '/repo', permissions: 'read-only', timeoutMs: 90_000 }));
	});

	test('a harness that will not start is skipped too — nothing here throws', async () => {
		const { driver } = setupDriver({
			result: () => {
				throw new Error('spawn claude ENOENT');
			},
		});

		const { findings, notes } = await runStandardsReview({
			cwd: '/repo',
			driver,
			packages: [packageOf({ rules: [rule({ id: 'common-placement' })] })],
			channels: [],
			files: ['src/a.ts'],
		});

		// a repo whose harness is absent is not a repo in violation
		expect(findings).toStrictEqual([]);
		expect(notes).toStrictEqual(['agent review skipped — agent invocation failed: spawn claude ENOENT']);
	});
});
