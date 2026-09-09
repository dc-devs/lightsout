import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
import type { Driver } from '#src/drivers/index.ts';
import { runImplementPipeline } from '#src/pipeline/index.ts';
import { expectDefined } from '#tests/helpers/expectDefined.ts';
import { report } from '#tests/helpers/report.ts';
import { reviewOneAdvisory } from '#tests/helpers/reviewOneAdvisory.ts';
import { reviewReport } from '#tests/helpers/reviewReport.ts';
import { roleOf } from '#tests/helpers/roleOf.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { verdict } from '#tests/helpers/verdict.ts';
import { withTestChangeReview } from '#tests/helpers/withTestChangeReview.ts';
import { writeSource } from '#tests/helpers/writeSource.ts';

const grant = 'pnpm --filter api run prisma:migrate:dev:name';

// The engine grants its own self-check by addressing the running CLI bundle, so
// the agent's subprocess resolves this engine. The harness matches the prefix
// literally, so the prefix carries no arguments of its own.
const selfCheckPrefix = `node ${process.argv[1]} self-check`;

test('agentCommands: grant section reaches the executor, driver gets allowedCommands, test writers stay ungranted', async () => {
	const dir = setupConsumerRepo({ config: { 'agent-commands': [grant] } });

	const invocations: { role: string; systemPrompt?: string; allowedCommands?: string[] }[] = [];

	const driver: Driver = {
		name: 'stub',
		invoke: withTestChangeReview({
			invoke: async ({ prompt, systemPrompt, allowedCommands }) => {
				const role = roleOf(prompt);

				if (role === 'standards-review') {
					return { text: reviewReport(), exitCode: 0 };
				}

				invocations.push({ role, systemPrompt, allowedCommands });

				if (role === 'write-tests') {
					mkdirSync(join(dir, 'test'), { recursive: true });
					writeFileSync(join(dir, 'test/feature.test.js'), '// stub\n');

					return { text: report({ changedFiles: [{ path: 'test/feature.test.js', summary: 'tests' }] }), exitCode: 0 };
				}

				if (role === 'refactor') {
					return { text: report(), exitCode: 0 };
				}

				writeSource({ dir, path: 'src/feature.js', source: 'export const feature = () => 2;\n' });

				return { text: report({ changedFiles: [{ path: 'src/feature.js', summary: 'feature' }] }), exitCode: 0 };
			},
		}),
	};

	const config = await readConfig({ cwd: dir });
	const result = await runImplementPipeline({ cwd: dir, planPath: 'plan.md', driver, config });

	expect(result.ok).toBe(true);

	const implement = invocations.find((invocation) => invocation.role === 'implement');
	const writer = invocations.find((invocation) => invocation.role === 'write-tests');

	// The grant is stable for the whole run, so it rides the cached system prompt.
	// executor role prompt carries the grant section
	expect(implement?.systemPrompt?.includes('# Granted commands\n\nYou may run these shell commands')).toBeTruthy();
	// grant lists the exact prefix
	expect(implement?.systemPrompt?.includes(grant)).toBeTruthy();
	// driver receives allowedCommands for the executor: the consumer's own grant,
	// plus the engine's self-check prefix every working role is allowed
	expect(implement?.allowedCommands).toStrictEqual([grant, selfCheckPrefix]);
	// test-writer role prompt has no grant section
	expect(writer?.systemPrompt?.includes('# Granted commands\n\nYou may run these shell commands')).toBeFalsy();
	// harness-level allowance is uniform for working roles
	expect(writer?.allowedCommands).toStrictEqual([grant, selfCheckPrefix]);
});

test("agentCommands absent: no grant section, and the engine's own self-check the only allowance", async () => {
	const dir = setupConsumerRepo();

	let implementInvocation: { systemPrompt?: string; allowedCommands?: string[] } | undefined;

	const driver: Driver = {
		name: 'stub',
		invoke: withTestChangeReview({
			invoke: async ({ prompt, systemPrompt, allowedCommands }) => {
				if (roleOf(prompt) === 'implement') {
					implementInvocation = { systemPrompt, allowedCommands };
				}

				return { text: 'no report', exitCode: 0 };
			},
		}),
	};

	const config = await readConfig({ cwd: dir });

	await runImplementPipeline({ cwd: dir, planPath: 'plan.md', driver, config });

	// executor was invoked
	expectDefined(implementInvocation);
	expect(implementInvocation.systemPrompt?.includes('# Granted commands\n\nYou may run these shell commands')).toBeFalsy();
	// a consumer that granted nothing still allows the engine's own self-check,
	// which is the engine's grant rather than the consumer's
	expect(implementInvocation.allowedCommands).toStrictEqual([selfCheckPrefix]);
});

test('grants every working role the self-check prefix, and tells only the executor roles about it', async () => {
	const dir = setupConsumerRepo({ config: { 'agent-commands': [grant] } });

	const invocations: { role: string; systemPrompt?: string; allowedCommands?: string[] }[] = [];

	const driver: Driver = {
		name: 'stub',
		invoke: withTestChangeReview({
			invoke: async ({ prompt, systemPrompt, allowedCommands }) => {
				const role = roleOf(prompt);

				if (role === 'standards-review') {
					// One advisory, so the bounded cleanup loop has something to hand its
					// first round: this fixture's tree carries no qualifying deterministic
					// finding, and cleanup no longer spends a round on nothing.
					return { text: reviewOneAdvisory({ systemPrompt, path: 'src/feature.js' }), exitCode: 0 };
				}

				invocations.push({ role, systemPrompt, allowedCommands });

				if (role === 'write-tests') {
					mkdirSync(join(dir, 'test'), { recursive: true });
					writeFileSync(join(dir, 'test/feature.test.js'), '// stub\n');

					return { text: report({ changedFiles: [{ path: 'test/feature.test.js', summary: 'tests' }] }), exitCode: 0 };
				}

				if (role === 'refactor') {
					return { text: report(), exitCode: 0 };
				}

				writeSource({ dir, path: 'src/feature.js', source: 'export const feature = () => 2;\n' });

				return { text: report({ changedFiles: [{ path: 'src/feature.js', summary: 'feature' }] }), exitCode: 0 };
			},
		}),
	};

	const config = await readConfig({ cwd: dir });
	const result = await runImplementPipeline({ cwd: dir, planPath: 'plan.md', driver, config });

	expect(result.ok).toBe(true);

	const implement = invocations.find((invocation) => invocation.role === 'implement');
	const writer = invocations.find((invocation) => invocation.role === 'write-tests');
	const refactor = invocations.find((invocation) => invocation.role === 'refactor');
	// the command the engine hands over names the live run and nothing else
	const granted = `${selfCheckPrefix} --run ${result.manifest.runId}`;

	expectDefined(implement);
	expectDefined(writer);
	expectDefined(refactor);
	// the harness allowance stays uniform for every working role: the consumer's
	// own granted commands, plus the engine's self-check prefix
	expect(implement.allowedCommands).toStrictEqual([grant, selfCheckPrefix]);
	expect(refactor.allowedCommands).toStrictEqual([grant, selfCheckPrefix]);
	expect(writer.allowedCommands).toStrictEqual([grant, selfCheckPrefix]);
	// the binding grant is the prompt section, and only the two executor roles
	// are given it — each with the command verbatim
	expect(implement.systemPrompt?.includes(granted)).toBeTruthy();
	expect(refactor.systemPrompt?.includes(granted)).toBeTruthy();
	// the test writer is never told the command exists, so it never runs it
	expect(writer.systemPrompt?.includes(selfCheckPrefix)).toBeFalsy();
});

test('hands a fix re-invocation the same system prompt its first spawn carried', async () => {
	// the unit gate goes red the moment implement lands and never recovers, so
	// verify-implement always buys the executor a fix re-invocation
	const dir = setupConsumerRepo({ scripts: { test: 'test ! -f BROKEN' } });

	let implementSystemPrompt: string | undefined;
	let fixSystemPrompt: string | undefined;

	const driver: Driver = {
		name: 'stub',
		invoke: withTestChangeReview({
			invoke: async ({ prompt, systemPrompt }) => {
				const role = roleOf(prompt);

				if (role === 'standards-review') {
					return { text: reviewReport(), exitCode: 0 };
				}

				if (role === 'supervisor') {
					return { text: verdict(), exitCode: 0 };
				}

				if (role === 'fix') {
					fixSystemPrompt = fixSystemPrompt ?? systemPrompt;

					return { text: report(), exitCode: 0 };
				}

				implementSystemPrompt = implementSystemPrompt ?? systemPrompt;
				writeSource({ dir, path: 'src/feature.js', source: 'export const feature = () => 2;\n' });
				writeFileSync(join(dir, 'BROKEN'), 'x');

				return { text: report({ changedFiles: [{ path: 'src/feature.js', summary: 'feature' }] }), exitCode: 0 };
			},
		}),
	};

	const config = await readConfig({ cwd: dir });
	const result = await runImplementPipeline({ cwd: dir, planPath: 'plan.md', driver, config });

	expectDefined(implementSystemPrompt);
	expectDefined(fixSystemPrompt);
	// the self-check section rides the cached system prompt, so a fix spawn reads
	// the identical bytes its first spawn read — a section on one but not the
	// other would split the role's prompt cache in two
	expect(fixSystemPrompt).toBe(implementSystemPrompt);
	// and what they share really is the self-check section, not an empty prompt
	expect(fixSystemPrompt.includes(`${selfCheckPrefix} --run ${result.manifest.runId}`)).toBeTruthy();
});
