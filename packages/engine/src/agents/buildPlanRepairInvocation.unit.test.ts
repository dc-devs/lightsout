import { expect, test } from '@jest/globals';
import { buildPlanRepairInvocation } from '#src/agents/index.ts';
import type { StructuralFinding } from '#src/contracts/index.ts';

/** A full StructuralFinding with per-test overrides. */
const finding = (overrides: Partial<StructuralFinding> = {}): StructuralFinding => ({
	check: 'no-placeholders',
	severity: 'blocking',
	phase: 'plan.md',
	issue: 'unresolved TBD marker',
	location: 'Files to Create',
	fix: 'resolve the TBD from the verified facts',
	...overrides,
});

/** The workspace reference paths the repairer Reads on demand. */
const setupRepair = () => ({
	decisionsPath: '/tmp/.lightsout/plans/widget-flag/decisions.json',
	brainstormDecisionsPath: '/tmp/.lightsout/plans/widget-flag/brainstorm-decisions.json',
	factsPath: '/tmp/.lightsout/plans/widget-flag/facts.json',
});

test('buildPlanRepairInvocation: the prompt opens with the repair marker and every section the role prompt promises', () => {
	const { decisionsPath, factsPath } = setupRepair();

	const { prompt } = buildPlanRepairInvocation({ findings: [finding()], planPaths: ['/tmp/plans/widget-flag.md'], decisionsPath, factsPath });

	// the marker runPlanDraft keys repair invocations off
	expect(prompt.startsWith('# Repair input')).toBeTruthy();
	expect(prompt.includes('## Plan files to repair (Edit in place)')).toBeTruthy();
	expect(prompt.includes('## Structural findings to resolve')).toBeTruthy();
	expect(prompt.includes('## Reference files (Read on demand)')).toBeTruthy();
	// the closing reminder names the report contract
	expect(prompt).toMatch(/PlanFixReport/);
});

test('buildPlanRepairInvocation: plan paths render as `- <path>` bullets, one per file', () => {
	const { decisionsPath, factsPath } = setupRepair();

	const { prompt } = buildPlanRepairInvocation({
		findings: [finding()],
		planPaths: ['/tmp/plans/overview.md', '/tmp/plans/phase1-core.md'],
		decisionsPath,
		factsPath,
	});

	// each plan file gets its own bullet
	expect(prompt.includes('- /tmp/plans/overview.md\n- /tmp/plans/phase1-core.md')).toBeTruthy();
	// The `- <path>` bullet is the cross-file contract: the writer's output lines
	// and the repairer's plan-file bullets share it, so one prompt parser reads both.
	expect(/- (\S+\.md)/.exec(prompt)?.[1]).toBe('/tmp/plans/overview.md');
});

test('buildPlanRepairInvocation: each finding carries its check, location, issue, and exact fix string', () => {
	const { decisionsPath, factsPath } = setupRepair();
	const findings = [
		finding(),
		finding({ check: 'sections-present', issue: 'Verification section missing', location: 'end of plan', fix: 'add a ## Verification section' }),
	];

	const { prompt } = buildPlanRepairInvocation({ findings, planPaths: ['/tmp/plans/widget-flag.md'], decisionsPath, factsPath });

	expect(prompt.includes('- [no-placeholders] Files to Create — unresolved TBD marker\n  fix: resolve the TBD from the verified facts')).toBeTruthy();
	expect(prompt.includes('- [sections-present] end of plan — Verification section missing\n  fix: add a ## Verification section')).toBeTruthy();
});

test('buildPlanRepairInvocation: decisions and facts arrive as paths to Read, never as inlined content', () => {
	const { decisionsPath, factsPath } = setupRepair();

	const { prompt } = buildPlanRepairInvocation({ findings: [finding()], planPaths: ['/tmp/plans/widget-flag.md'], decisionsPath, factsPath });

	// the decisions record renders as a path bullet
	expect(prompt.includes(`- Decisions record: ${decisionsPath}`)).toBeTruthy();
	// the verified facts render as a path bullet
	expect(prompt.includes(`- Verified facts: ${factsPath}`)).toBeTruthy();
	// no reference content rides the prompt — a mechanical repair never pays for
	// it
	expect(prompt.includes('```json')).toBeFalsy();
});

test('buildPlanRepairInvocation: a brainstorm path lists both decision files, labelling the brainstorm one as settled before planning', () => {
	const { decisionsPath, brainstormDecisionsPath, factsPath } = setupRepair();

	const { prompt } = buildPlanRepairInvocation({
		findings: [finding()],
		planPaths: ['/tmp/plans/widget-flag.md'],
		decisionsPath,
		brainstormDecisionsPath,
		factsPath,
	});

	// the full section pins the order: plan decisions first, brainstorm second, facts closing
	expect(
		prompt.includes(
			`## Reference files (Read on demand)\n\n- Decisions record: ${decisionsPath}\n- Brainstorm decisions (settled during brainstorm, before planning began): ${brainstormDecisionsPath}\n- Verified facts: ${factsPath}`,
		),
	).toBeTruthy();
});

test('buildPlanRepairInvocation: without a brainstorm path the reference section is exactly what it is today', () => {
	const { decisionsPath, factsPath } = setupRepair();

	const { prompt } = buildPlanRepairInvocation({ findings: [finding()], planPaths: ['/tmp/plans/widget-flag.md'], decisionsPath, factsPath });

	// no brainstorm hand-off → the section is byte-identical to the two-file form
	expect(prompt.includes(`## Reference files (Read on demand)\n\n- Decisions record: ${decisionsPath}\n- Verified facts: ${factsPath}`)).toBeTruthy();
	expect(prompt.includes('Brainstorm decisions')).toBeFalsy();
});

test('buildPlanRepairInvocation: the system prompt is the repairer role and the plan template is absent — edit, never re-author', () => {
	const { decisionsPath, factsPath } = setupRepair();

	const { systemPrompt, prompt } = buildPlanRepairInvocation({ findings: [finding()], planPaths: ['/tmp/plans/widget-flag.md'], decisionsPath, factsPath });

	expect(systemPrompt).toMatch(/Plan Repairer/);
	// the hard rule against restructuring is in the role
	expect(systemPrompt).toMatch(/minimal edits/i);
	// no authoring template for a repair role
	expect(systemPrompt.includes('# Plan Template')).toBeFalsy();
	// a repair invocation can never read as an author invocation
	expect(prompt.includes('# Draft input')).toBeFalsy();
});

test('buildPlanRepairInvocation: declared documentation surfaces reach the repairer between the findings and the reference files', () => {
	const { decisionsPath, factsPath } = setupRepair();

	const { prompt } = buildPlanRepairInvocation({
		findings: [finding({ check: 'sections-present', issue: 'Documentation section missing', fix: "add a '## Documentation' section" })],
		planPaths: ['/tmp/plans/widget-flag.md'],
		decisionsPath,
		factsPath,
		docs: [
			{ path: 'README.md', covers: 'The product tour.' },
			{ path: 'docs/configuration.md', covers: 'Every configuration key.' },
		],
	});

	// the repair role forbids inventing a section's content, so the list it must
	// choose from rides the prompt rather than being guessed
	expect(prompt.includes('## Documentation surfaces')).toBeTruthy();
	expect(prompt.includes('- `README.md` — The product tour.')).toBeTruthy();
	expect(prompt.includes('- `docs/configuration.md` — Every configuration key.')).toBeTruthy();
	// the exact sentence the writer's brief and the template both state
	expect(prompt.includes('Nothing user-facing — no docs needed.')).toBeTruthy();
	// the brief lands before the files the repairer only Reads on demand
	expect(prompt.indexOf('## Documentation surfaces')).toBeLessThan(prompt.indexOf('## Reference files (Read on demand)'));
	expect(prompt.indexOf('## Structural findings to resolve')).toBeLessThan(prompt.indexOf('## Documentation surfaces'));
});

test('buildPlanRepairInvocation: a repository declaring no surfaces gets the invocation it got before the key existed', () => {
	const { decisionsPath, factsPath } = setupRepair();

	const { prompt } = buildPlanRepairInvocation({ findings: [finding()], planPaths: ['/tmp/plans/widget-flag.md'], decisionsPath, factsPath });

	// no section, no bullet, no sentence — an undeclared repository pays nothing
	// for a key it never wrote
	expect(prompt.includes('Documentation')).toBeFalsy();
	// and the sections it does carry are exactly the three it always carried
	expect(prompt.split('\n\n').filter((section) => section.startsWith('## '))).toStrictEqual([
		'## Plan files to repair (Edit in place)',
		'## Structural findings to resolve',
		'## Reference files (Read on demand)',
	]);
});
