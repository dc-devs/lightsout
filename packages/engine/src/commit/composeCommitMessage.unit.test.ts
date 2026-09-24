import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { composeCommitMessage } from '#src/commit/index.ts';
import { type AgentUsage, type LightsoutConfig, Permissions } from '#src/contracts/index.ts';
import type { Driver, DriverInvocation } from '#src/drivers/index.ts';
import { commitAll } from '#tests/helpers/commitAll.ts';
import { createUncalledDriver } from '#tests/helpers/createUncalledDriver.ts';
import { runInRepo } from '#tests/helpers/runInRepo.ts';
import { writeRepoFile } from '#tests/helpers/writeRepoFile.ts';

const config: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false } };

const runId = 'run-1234-abcd';

/** The new file the staged change holds — named so a case can find it in the prompt the agent was handed. */
const stagedFile = 'src/widget.ts';

const fallbackSubject = 'LO-167 001-commit-messages: Commit messages that describe the change';

const usageFigures: AgentUsage = { inputTokens: 120, outputTokens: 30, cacheReadTokens: 400, cacheCreationTokens: 7, costUsd: 0.02 };

/** The first line of a commit message — what `git log --pretty=%s` would show. */
const subjectOf = ({ message }: { message: string }) => message.split('\n')[0];

/**
 * A real repository with one commit and, on top of it, a new source file staged
 * the way `commitWorkOrderWork` stages — so the composer's read of the staged
 * change is git's own answer, never a stub.
 */
const stagedRepo = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-compose-'));

	runInRepo({ cwd, command: 'git', args: ['init', '-q', '-b', 'main'] });
	writeRepoFile({ cwd, path: 'README.md', content: '# repo\n' });
	commitAll({ cwd, message: 'init' });
	writeRepoFile({ cwd, path: stagedFile, content: 'export const widget = 1;\n' });
	runInRepo({ cwd, command: 'git', args: ['add', '-A', '--', '.'] });

	return cwd;
};

interface SetupParams {
	/** The final text the stub harness answers every invocation with. */
	text?: string;
	/** A spawn that rejects, as a harness that is down or killed at its ceiling does. */
	error?: Error;
	/** Usage figures the stub reports on each answer. */
	usage?: AgentUsage;
	/** The reference the subject opens with. */
	reference?: string;
	/** The plan unit named on the body's plan line; omitted for a commit with no plan unit. */
	unit?: string;
}

/** The address one commit is made under, and collectors for the progress lines and the usage the composer hands back. */
const collectComposition = ({ reference = 'LO-167', unit }: { reference?: string; unit?: string }) => {
	const progress: string[] = [];
	const usageCalls: { usage?: AgentUsage }[] = [];
	const address = { reference, fallbackSubject, context: 'Commit messages that describe the change', ...(unit === undefined ? {} : { unit }) };

	const onProgress = (message: string) => {
		progress.push(message);
	};

	const onUsage = async (call: { usage?: AgentUsage }) => {
		usageCalls.push(call);
	};

	return { address, progress, usageCalls, onProgress, onUsage };
};

/** A staged change and a stub harness that records every invocation it is handed. */
const setupComposer = ({ text = '', error, usage, reference, unit }: SetupParams = {}) => {
	const invocations: DriverInvocation[] = [];

	const driver: Driver = {
		name: 'stub',
		invoke: async (invocation) => {
			invocations.push(invocation);

			if (error) {
				throw error;
			}

			return { text, exitCode: 0, ...(usage === undefined ? {} : { usage }) };
		},
	};

	return { cwd: stagedRepo(), driver, invocations, ...collectComposition({ reference, unit }) };
};

/**
 * A folder git cannot read and a harness that fails the case if it is ever
 * asked — a second factory because no staged change and no answer is a
 * different arrangement, not a variant of the scripted one.
 */
const setupUnreadableComposer = () => ({
	cwd: mkdtempSync(join(tmpdir(), 'lightsout-not-a-repo-')),
	driver: createUncalledDriver({ reason: 'the commit-message agent was asked about a change nobody could read' }),
	...collectComposition({}),
});

describe('composeCommitMessage', () => {
	test("composeCommitMessage: opens the subject with the reference and the agent's summary, then the body, the plan line and the run line", async () => {
		const { cwd, driver, address, onProgress } = setupComposer({
			text: JSON.stringify({ summary: 'add the widget module', body: 'The widget is exported for the queue to read.' }),
			unit: '001-commit-messages',
		});

		const message = await composeCommitMessage({ cwd, driver, config, address, runId, onProgress });

		expect(message).toBe(
			'LO-167: add the widget module\n\nThe widget is exported for the queue to read.\n\nlightsout plan 001-commit-messages\nlightsout run run-1234-abcd\n',
		);
	});

	test('composeCommitMessage: leaves out the body and the plan line when the agent gave no body and the address names no unit', async () => {
		const { cwd, driver, address, onProgress } = setupComposer({ text: JSON.stringify({ summary: 'add the widget module' }) });

		const message = await composeCommitMessage({ cwd, driver, config, address, runId, onProgress });

		expect(message).toBe('LO-167: add the widget module\n\nlightsout run run-1234-abcd\n');
	});

	test('composeCommitMessage: asks read-only, with no commands granted and a three-minute ceiling', async () => {
		const { cwd, driver, address, invocations, onProgress } = setupComposer({ text: JSON.stringify({ summary: 'add the widget module' }) });

		await composeCommitMessage({ cwd, driver, config, address, runId, onProgress });

		const [asked] = invocations;
		expect(asked).toEqual(expect.objectContaining({ permissions: Permissions.ReadOnly, timeoutMs: 180_000 }));
		expect(asked?.allowedCommands ?? []).toEqual([]);
		expect(asked?.prompt).toContain(stagedFile);
	});

	test("composeCommitMessage: falls back to the address's template subject and narrates the failure when the driver throws", async () => {
		const { cwd, driver, address, progress, onProgress } = setupComposer({
			error: new Error('harness timed out after 180000ms'),
			unit: '001-commit-messages',
		});

		const message = await composeCommitMessage({ cwd, driver, config, address, runId, onProgress });

		// a harness that is down never costs the commit: the template subject
		// stands in, and the trailer lines are the same as on the agent path
		expect(message).toBe(`${fallbackSubject}\n\nlightsout plan 001-commit-messages\nlightsout run run-1234-abcd\n`);
		expect(progress.filter((line) => line.includes('harness timed out after 180000ms'))).toHaveLength(1);
	});

	test('composeCommitMessage: falls back to the template subject after the answer fails the contract on the role rung and its re-emit', async () => {
		const { cwd, driver, address, invocations, onProgress } = setupComposer({
			text: 'Sure — this change adds a widget module, so a good summary would be "add the widget".',
		});

		const message = await composeCommitMessage({ cwd, driver, config, address, runId, onProgress });

		expect(subjectOf({ message })).toBe(fallbackSubject);
		// the role rung and its one cheap re-emit both ran before the fallback
		expect(invocations).toHaveLength(2);
	});

	test('composeCommitMessage: falls back without invoking the agent when the staged change cannot be read', async () => {
		const { cwd, driver, address, progress, onProgress } = setupUnreadableComposer();

		const message = await composeCommitMessage({ cwd, driver, config, address, runId, onProgress });

		expect(message).toBe(`${fallbackSubject}\n\nlightsout run run-1234-abcd\n`);
		// the uncalled driver's reason would surface in the narration had it been invoked
		expect(progress.some((line) => line.includes('nobody could read'))).toBe(false);
		const narrated = progress.filter((line) => line.includes(fallbackSubject));
		expect(narrated).toHaveLength(1);
		expect(narrated[0]).toMatch(/staged/iu);
	});

	test("composeCommitMessage: hands the agent call's usage to onUsage once, and only when the agent was invoked", async () => {
		const invoked = setupComposer({ text: JSON.stringify({ summary: 'add the widget module' }), usage: usageFigures });
		const unreadable = setupUnreadableComposer();

		await composeCommitMessage({ cwd: invoked.cwd, driver: invoked.driver, config, address: invoked.address, runId, onUsage: invoked.onUsage });
		await composeCommitMessage({ cwd: unreadable.cwd, driver: unreadable.driver, config, address: unreadable.address, runId, onUsage: unreadable.onUsage });

		expect(invoked.usageCalls).toStrictEqual([{ usage: usageFigures }]);
		expect(unreadable.usageCalls).toStrictEqual([]);
	});

	test('composeCommitMessage: uses the summary alone as the subject when the reference is empty', async () => {
		const { cwd, driver, address, onProgress } = setupComposer({ text: JSON.stringify({ summary: 'add the widget module' }), reference: '' });

		const message = await composeCommitMessage({ cwd, driver, config, address, runId, onProgress });

		expect(subjectOf({ message })).toBe('add the widget module');
	});

	test('composeCommitMessage: strips a repeated ticket reference from the summary and falls back when nothing else is left', async () => {
		const repeated = setupComposer({ text: JSON.stringify({ summary: 'lo-167: add the widget' }) });
		const bare = setupComposer({ text: JSON.stringify({ summary: 'LO-167' }) });

		const strippedMessage = await composeCommitMessage({ cwd: repeated.cwd, driver: repeated.driver, config, address: repeated.address, runId });
		const bareMessage = await composeCommitMessage({ cwd: bare.cwd, driver: bare.driver, config, address: bare.address, runId, onProgress: bare.onProgress });

		// a composer that prefixed blindly would name the ticket twice
		expect(subjectOf({ message: strippedMessage })).toBe('LO-167: add the widget');
		// a summary that was nothing but the reference says nothing about the change
		expect(subjectOf({ message: bareMessage })).toBe(fallbackSubject);
		expect(bare.progress.filter((line) => line.includes(fallbackSubject))).toHaveLength(1);
	});

	test.each([
		{ reference: 'LO-167', summary: 'LO-1670 fix the parser', expected: 'LO-167: LO-1670 fix the parser' },
		{ reference: 'lo.1', summary: 'lox1 add it', expected: 'lo.1: lox1 add it' },
	])(
		'composeCommitMessage: strips the reference only as a whole literal token, never from a longer token or as a pattern',
		async ({ reference, summary, expected }) => {
			const { cwd, driver, address, onProgress } = setupComposer({ text: JSON.stringify({ summary }), reference });

			const message = await composeCommitMessage({ cwd, driver, config, address, runId, onProgress });

			expect(subjectOf({ message })).toBe(expected);
		},
	);
});
