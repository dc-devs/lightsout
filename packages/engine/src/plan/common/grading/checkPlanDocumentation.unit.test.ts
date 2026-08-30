import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import type { ConfigDocs } from '#src/contracts/index.ts';
import type { Driver, DriverInvocation } from '#src/drivers/index.ts';
import { checkPlanDocumentation } from '#src/plan/common/grading/checkPlanDocumentation.ts';

/** The two surfaces a declaring repository writes in these cases. */
const docs = (): ConfigDocs => [
	{ path: 'README.md', covers: 'The product tour.' },
	{ path: 'docs/configuration.md', covers: 'Every configuration key.' },
];

/** One finding, as the checker reports it — with an area of its own to prove the engine stamps rather than trusts. */
const reportedGap = { area: 'omitted-decision', gap: 'the claim names no declared document', decision: 'which document to update', options: [] };

/** A driver that answers every invocation with the same result, collecting what it was handed. */
const createStubDriver = ({
	text,
	exitCode = 0,
	rateLimited,
	invocations = [],
}: {
	text: string;
	exitCode?: number;
	rateLimited?: boolean;
	invocations?: DriverInvocation[];
}): Driver => ({
	name: 'stub',
	invoke: async (invocation) => {
		invocations.push(invocation);

		return { text, exitCode, rateLimited };
	},
});

/** The shared call shape: one single-plan deliverable in a fresh workspace. */
const setup = ({ driver }: { driver: Driver }) => {
	const workspaceDir = mkdtempSync(join(tmpdir(), 'lightsout-docs-check-'));

	return {
		cwd: workspaceDir,
		driver,
		name: 'demo',
		workspaceDir,
		planPaths: [join(workspaceDir, 'plan.md')],
		files: [{ path: join(workspaceDir, 'plan.md'), text: '# Plan\n\n## Documentation\n\nNothing user-facing — no docs needed.' }],
		timeoutMs: 30 * 60 * 1000,
		messages: [] as string[],
	};
};

test('checkPlanDocumentation: a repository declaring no surfaces spawns nothing and reports nothing', async () => {
	const invocations: DriverInvocation[] = [];
	const params = setup({ driver: createStubDriver({ text: JSON.stringify({ gaps: [reportedGap] }), invocations }) });

	const result = await checkPlanDocumentation({ ...params, onProgress: (message) => params.messages.push(message) });

	// an undeclared repository pays nothing — not a spawn, not a progress line
	expect(result).toStrictEqual({ gaps: [], failures: [], rateLimited: false });
	expect(invocations).toStrictEqual([]);
	expect(params.messages).toStrictEqual([]);
});

test('checkPlanDocumentation: a returned finding is stamped with the deliverable, the documentation area, needs-a-human, and no lens', async () => {
	const params = setup({ driver: createStubDriver({ text: JSON.stringify({ gaps: [reportedGap] }) }) });

	const result = await checkPlanDocumentation({ ...params, docs: docs(), onProgress: (message) => params.messages.push(message) });

	expect(result.failures).toStrictEqual([]);
	expect(result.gaps.length).toBe(1);
	// the checker reported `omitted-decision`; the engine's stamp is what lands, so
	// a finding cannot hide in the crowd under an area it was not given
	expect(result.gaps[0]?.area).toBe('missing-documentation');
	expect(result.gaps[0]?.phase).toBe('plan.md');
	// the checker's own job is the judgment, so no judge ever sees this finding
	expect(result.gaps[0]?.outcome).toBe('needs-a-human');
	// no per-file lens produced it, which is what makes the field optional
	expect(result.gaps[0]?.lens).toBe(undefined);
	// and the run says what it checked and against how many surfaces
	expect(params.messages).toStrictEqual(['plan grade demo: documentation check — 1 finding(s) against 2 declared surface(s)']);
});

test('checkPlanDocumentation: a checker that finds nothing returns no gaps and no failure', async () => {
	const params = setup({ driver: createStubDriver({ text: JSON.stringify({ gaps: [] }) }) });

	const result = await checkPlanDocumentation({ ...params, docs: docs(), onProgress: (message) => params.messages.push(message) });

	// the check ran and said nothing, which is not the same as never running
	expect(result).toStrictEqual({ gaps: [], failures: [], rateLimited: false });
	expect(params.messages).toStrictEqual(['plan grade demo: documentation check — 0 finding(s) against 2 declared surface(s)']);
});

test('checkPlanDocumentation: a failed outcome returns one documentation failure and no gaps', async () => {
	const params = setup({ driver: createStubDriver({ text: 'not json at all', exitCode: 1 }) });

	const result = await checkPlanDocumentation({ ...params, docs: docs(), onProgress: (message) => params.messages.push(message) });

	expect(result.gaps).toStrictEqual([]);
	expect(result.rateLimited).toBe(false);
	// the failure names the checker the way a reader failure names its phase and
	// lens, because the string lands in the report's incompleteReason verbatim
	expect(result.failures.length).toBe(1);
	expect(result.failures[0]?.startsWith('documentation: ')).toBeTruthy();
});

test('checkPlanDocumentation: a rate-limited outcome says so, so the grade can park instead of retrying', async () => {
	const params = setup({ driver: createStubDriver({ text: '', exitCode: 1, rateLimited: true }) });

	const result = await checkPlanDocumentation({ ...params, docs: docs(), onProgress: (message) => params.messages.push(message) });

	expect(result.rateLimited).toBe(true);
	expect(result.failures).toStrictEqual(['documentation: rate limited or overloaded']);
});
