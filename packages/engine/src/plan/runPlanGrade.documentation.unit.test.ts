import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { type ConfigDocs, GradeReport } from '#src/contracts/index.ts';
import type { Driver, DriverInvocation } from '#src/drivers/index.ts';
import { getBlockingGaps } from '#src/plan/index.ts';
import { runPlanGrade } from '#src/plan/runPlanGrade.ts';
import { cleanPlanBody } from '#tests/helpers/cleanPlanBody.ts';
import { createGapCheckDriver } from '#tests/helpers/createGapCheckDriver.ts';
import { expectStatus } from '#tests/helpers/expectStatus.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { writePlanDeliverable } from '#tests/helpers/writePlanDeliverable.ts';

// The whole-plan documentation check: what a repository declaring surfaces gets
// out of a grade pass, and what an undeclared one is charged for it.

/** The surfaces a declaring repository writes — what the checker is briefed on. */
const declaredDocs: ConfigDocs = [
	{ path: 'README.md', covers: 'The product tour and the index of every other document.' },
	{ path: 'docs/configuration.md', covers: 'Every configuration key.' },
];

/** What the whole-plan checker reports when a plan adds surface and names no declared document. */
const missingDocsGap = {
	area: 'missing-documentation',
	gap: 'the plan adds a config key and claims nothing user-facing',
	decision: 'which declared document to update',
	options: ['docs/configuration.md', 'nothing user-facing after all'],
};

/**
 * A consumer repo with one graded plan on disk. Passing `docs` is what turns the
 * documentation check on, and a declaring repo's plan states its claim because
 * the structural lint now requires the section.
 */
const setup = ({ name, docs, docsGaps = [] }: { name: string; docs?: ConfigDocs; docsGaps?: unknown[] }) => {
	const cwd = setupConsumerRepo(docs === undefined ? {} : { config: { docs } });
	const documentation = docs === undefined ? undefined : 'Nothing user-facing — no docs needed.';
	const dir = writePlanDeliverable({ cwd, name, body: cleanPlanBody({ title: 'Graded Plan', documentation }) });
	const invocations: DriverInvocation[] = [];

	return { cwd, name, invocations, gradePath: join(dir, 'grade.json'), driver: createGapCheckDriver({ docsGaps, invocations }) };
};

/**
 * A declaring repo whose docs checker answers badly and whose readers answer
 * clean.
 *
 * The checker is recognised by its SYSTEM prompt, not the per-invocation one: a
 * rejected payload is retried as a re-emit whose prompt is the reconstruct
 * instruction, so a stub keyed off `# Docs-check input` would answer the retry
 * as a reader and the failure would vanish.
 */
const setupFailingCheck = ({ name, response }: { name: string; response: { text: string; exitCode: number; rateLimited?: boolean } }) => {
	const cwd = setupConsumerRepo({ config: { docs: declaredDocs } });
	const dir = writePlanDeliverable({
		cwd,
		name,
		body: cleanPlanBody({ title: 'Graded Plan', documentation: 'Nothing user-facing — no docs needed.' }),
	});
	const driver: Driver = {
		name: 'stub',
		invoke: async (invocation) =>
			invocation.systemPrompt?.includes("# The repository's declared documentation surfaces") ? response : { text: JSON.stringify({ gaps: [] }), exitCode: 0 },
	};

	return { cwd, name, driver, gradePath: join(dir, 'grade.json') };
};

test('plan grade: a declared repository whose plan touches no declared document is flagged, and the finding blocks', async () => {
	const { cwd, name, driver, gradePath } = setup({ name: 'undocumented', docs: declaredDocs, docsGaps: [missingDocsGap] });

	const result = await runPlanGrade({ cwd, driver, name });

	expectStatus(result, 'complete');

	const recorded = GradeReport.parse(JSON.parse(readFileSync(gradePath, 'utf8')));
	const documentation = recorded.gaps.filter(({ area }) => area === 'missing-documentation');

	// one finding per plan, not per lens and not per declared document
	expect(documentation.length).toBe(1);
	// the engine stamps its identity: the checker's own judgment stands, and no
	// per-file lens produced it
	expect(documentation[0]?.outcome).toBe('needs-a-human');
	expect(documentation[0]?.lens).toBe(undefined);
	expect(documentation[0]?.phase).toBe('plan.md');
	// it gates the grade even though every reader returned clean
	expect(getBlockingGaps({ gaps: recorded.gaps }).length).toBe(1);
	expect(recorded.passed).toBe(false);
	expect(recorded.grade).toBe('below-A');
});

test('plan grade: a repository declaring no surfaces sees no documentation step, question or cost', async () => {
	const { cwd, name, driver, invocations, gradePath } = setup({ name: 'undeclared' });

	const result = await runPlanGrade({ cwd, driver, name });

	expectStatus(result, 'complete');
	// nothing was spawned for it
	expect(invocations.some(({ prompt }) => prompt.includes('# Docs-check input'))).toBeFalsy();
	// so no transcript was written either
	expect(existsSync(join(cwd, '.lightsout', 'plans', 'undeclared', 'grade-documentation-stream.jsonl'))).toBeFalsy();

	// and the verdict is the one this plan always earned
	const recorded = GradeReport.parse(JSON.parse(readFileSync(gradePath, 'utf8')));

	expect(recorded.gaps).toStrictEqual([]);
	expect(recorded.complete).toBe(true);
	expect(recorded.grade).toBe('A');
});

test('plan grade: a declared repository whose plan adds nothing user-facing is not flagged', async () => {
	const { cwd, name, driver, invocations } = setup({ name: 'documented', docs: declaredDocs });

	const result = await runPlanGrade({ cwd, driver, name });

	expectStatus(result, 'complete');
	// the check ran — which is what makes this different from an undeclared repo
	expect(invocations.some(({ prompt }) => prompt.includes('# Docs-check input'))).toBeTruthy();
	// and it said nothing
	expect(result.grade.gaps).toStrictEqual([]);
	expect(result.grade.grade).toBe('A');
	expect(result.grade.complete).toBe(true);
});

test('plan grade: a documentation checker that could not run leaves the pass incomplete, never a clean bill', async () => {
	const { cwd, name, driver, gradePath } = setupFailingCheck({ name: 'docs-failed', response: { text: 'not a report', exitCode: 1 } });

	const result = await runPlanGrade({ cwd, driver, name });

	expectStatus(result, 'failed');

	const recorded = GradeReport.parse(JSON.parse(readFileSync(gradePath, 'utf8')));

	// a check that did not run must never read as a clean bill
	expect(recorded.complete).toBe(false);
	expect(recorded.incompleteReason?.includes('documentation')).toBeTruthy();
	expect(recorded.grade).toBe('below-A');
});

test('plan grade: a rate-limited documentation checker parks the pass rather than failing it', async () => {
	const { cwd, name, driver } = setupFailingCheck({ name: 'docs-parked', response: { text: '', exitCode: 1, rateLimited: true } });

	const result = await runPlanGrade({ cwd, driver, name });

	// every reader answered, so the pass is resumable rather than broken — the
	// same park a rate-limited reader earns
	expectStatus(result, 'paused-rate-limit');
	expect(result.error).toContain('lightsout plan grade --name docs-parked');
	expect(result.grade?.complete).toBe(false);
	expect(result.grade?.incompleteReason).toContain('documentation');
});
