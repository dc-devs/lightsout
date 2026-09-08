import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { DecisionSource, type DecisionsRecord, FindingSeverity, LightsoutConfig, StructuralCheck } from '#src/contracts/index.ts';
import { renderDecisionLog } from '#src/plan/decisionLog/index.ts';
import { lintPlanStructure } from '#src/plan/lint/lintPlanStructure.ts';
import { cleanPlanBody } from '#tests/helpers/cleanPlanBody.ts';
import { emptyDecisionsRecord } from '#tests/helpers/emptyDecisionsRecord.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

/** Write a plan file into a plan's own folder and return its absolute path. */
const writePlan = ({ cwd, name, body }: { cwd: string; name: string; body: string }) => {
	const dir = join(cwd, '.lightsout', 'plans', 'demo');

	mkdirSync(dir, { recursive: true });

	const path = join(dir, name);

	writeFileSync(path, body);

	return path;
};

/** A plan whose Files-to-Create section names `count` new modules, plus any extra sections. */
const sizedPlan = ({ count, extra = '' }: { count: number; extra?: string }) => {
	const creates = Array.from({ length: count }, (_, index) => `### \`src/gen${index}.ts\`\n\nGenerated module ${index}.\n`).join('\n');

	return `# Plan

${renderDecisionLog({ decisions: [] })}

## Prerequisites

- None

## Global Constraints

- None

## Files to Create

${creates}
${extra}
## Scope Boundaries

**Do NOT:** wander.

## Verification

- \`true\` — types clean

## What Next Plan Expects

None.
`;
};

test('lintPlanStructure: a 60-file plan trips both size numbers — the created ceiling blocks, the touched count only notes', async () => {
	const cwd = setupConsumerRepo();
	const path = writePlan({ cwd, name: 'too-big.md', body: sizedPlan({ count: 60 }) });

	const findings = await lintPlanStructure({ cwd, planPaths: [path], decisions: emptyDecisionsRecord() });
	const ceiling = findings.find((finding) => finding.check === StructuralCheck.CreatedFilesWithinCeiling);
	const guardrail = findings.find((finding) => finding.check === StructuralCheck.ScopeWithinGuardrail);

	// 60 created files is more than a phase can specify — that one is a defect
	expect(ceiling?.severity).toBe(FindingSeverity.Blocking);
	expect(ceiling?.issue).toMatch(/creates 60 source files, over the 30-file ceiling/);
	// the touched count is a note about where the implementing agent stops, not a
	// defect: a 60-file mechanical phase has to stay legal
	expect(guardrail?.severity).toBe(FindingSeverity.Advisory);
	expect(guardrail?.issue).toMatch(/touches 60 source files, over the 50-file limit from the configured executor-file-limit/);
});

test('lintPlanStructure: a plan creating exactly 30 files sits on the ceiling rather than over it', async () => {
	const cwd = setupConsumerRepo();
	const path = writePlan({ cwd, name: 'thirty.md', body: sizedPlan({ count: 30 }) });

	const findings = await lintPlanStructure({ cwd, planPaths: [path], decisions: emptyDecisionsRecord() });

	// the ceiling is 30, not 29, got: ${JSON.stringify(findings)}
	expect(findings).toStrictEqual([]);
});

test('lintPlanStructure: a plan declaring its own File Budget silences the touched-file note it covers', async () => {
	const cwd = setupConsumerRepo();
	const modifies = Array.from({ length: 60 }, (_, index) => `### \`src/index.js\`\n\nRename an import (${index}).\n`).join('\n');
	const declared = writePlan({
		cwd,
		name: 'declared.md',
		body: sizedPlan({ count: 3, extra: `\n## File Budget\n\n80\n\n## Files to Modify\n\n${modifies}\n` }),
	});

	const findings = await lintPlanStructure({ cwd, planPaths: [declared], decisions: emptyDecisionsRecord() });

	// a phase that creates three files and edits one import everywhere is
	// legitimate work no repo-wide number can express, got:
	// ${JSON.stringify(findings)}
	expect(findings).toStrictEqual([]);
});

test('lintPlanStructure: the configured executor-file-limit moves the advisory off its default', async () => {
	const cwd = setupConsumerRepo();
	const config = LightsoutConfig.parse({ gates: { check: 'true', test: 'true', 'test-coverage': false }, 'executor-file-limit': 10 });
	const path = writePlan({ cwd, name: 'configured-limit.md', body: sizedPlan({ count: 12 }) });

	const findings = await lintPlanStructure({ cwd, planPaths: [path], decisions: emptyDecisionsRecord(), config });

	expect(findings.map((finding) => finding.issue)).toStrictEqual([
		'plan touches 12 source files, over the 10-file limit from the configured executor-file-limit',
	]);
});

test('lintPlanStructure: a Files to Move heading naming one path is a blocking finding at its line', async () => {
	const cwd = setupConsumerRepo();
	const path = writePlan({ cwd, name: 'bad-move.md', body: sizedPlan({ count: 1, extra: '\n## Files to Move\n\n### `src/index.js`\n\nTo where?\n' }) });

	const findings = await lintPlanStructure({ cwd, planPaths: [path], decisions: emptyDecisionsRecord() });
	const move = findings.find((finding) => finding.check === StructuralCheck.MoveWellFormed);

	// a half-written move heading loses a file silently — the line number is what
	// the writer is pointed at
	expect(move?.severity).toBe(FindingSeverity.Blocking);
	expect(move?.location).toMatch(/^bad-move\.md:\d+$/);
});

test('lintPlanStructure: a clean plan returns no findings', async () => {
	const cwd = setupConsumerRepo();
	const path = writePlan({ cwd, name: 'clean.md', body: cleanPlanBody() });

	const findings = await lintPlanStructure({ cwd, planPaths: [path], decisions: emptyDecisionsRecord() });

	// clean plan should have no findings, got: ${JSON.stringify(findings)}
	expect(findings).toStrictEqual([]);
});

/** The clean plan with a snippet standing in for its Context prose. */
const planWith = ({ snippet }: { snippet: string }) => cleanPlanBody().replace('A tiny clean plan for the structural lint.', snippet);

test('lintPlanStructure: a path the Context prose names but the tree does not hold is one blocking prose-path finding', async () => {
	const cwd = setupConsumerRepo();
	const clean = writePlan({ cwd, name: 'clean-prose.md', body: cleanPlanBody() });
	const stale = writePlan({ cwd, name: 'stale-prose.md', body: planWith({ snippet: 'It replaces `src/ghost.ts`, which moved months ago.' }) });

	const before = await lintPlanStructure({ cwd, planPaths: [clean], decisions: emptyDecisionsRecord() });
	const after = await lintPlanStructure({ cwd, planPaths: [stale], decisions: emptyDecisionsRecord() });
	const prose = after.filter((finding) => finding.check === StructuralCheck.ProsePathExists);

	// only the heading paths were ever checked, so a wrong path in a sentence
	// belonged to nobody and survived into implementation
	expect(before).toStrictEqual([]);
	expect(prose.length).toBe(1);
	expect(prose[0]?.severity).toBe(FindingSeverity.Blocking);
	expect(prose[0]?.issue).toBe('path named in prose does not exist: src/ghost.ts');
	expect(prose[0]?.location ?? '').toMatch(/^stale-prose\.md:\d+$/);
	expect(after.length).toBe(before.length + 1);
});

test('lintPlanStructure: fence state resets per file — an unclosed fence never silences the next plan', async () => {
	const cwd = setupConsumerRepo();
	const unclosed = writePlan({ cwd, name: 'unclosed-fence.md', body: planWith({ snippet: '```ts\nconst {userName} = props;' }) });
	const following = writePlan({ cwd, name: 'after-fence.md', body: planWith({ snippet: 'Resolve the {token} before writing.' }) });

	const findings = await lintPlanStructure({ cwd, planPaths: [unclosed, following], decisions: emptyDecisionsRecord() });
	const placeholders = findings.filter((finding) => finding.check === StructuralCheck.NoPlaceholders);

	// only the second plan's prose token is flagged, got:
	// ${JSON.stringify(placeholders)}
	expect(placeholders.length).toBe(1);
	// the finding is attributed to the second plan
	expect(placeholders[0].location.startsWith('after-fence.md:')).toBeTruthy();
});

/** A plan whose only lint-relevant content is one modify path and one verification command. */
const packagePlan = ({ modifyPath, command }: { modifyPath: string; command: string }) => `# Plan

${renderDecisionLog({ decisions: [] })}

## Prerequisites

- None

## Global Constraints

- None

## Files to Modify

### \`${modifyPath}\`

Change something.

## Scope Boundaries

**Do NOT:** wander.

## Verification

- \`${command}\` — gates green

## What Next Plan Expects

None.
`;

test('lintPlanStructure: a path directly under packages/ with no package segment is flagged', async () => {
	const cwd = setupConsumerRepo();

	const body = packagePlan({ modifyPath: 'packages/loose.ts', command: 'true' });
	const path = writePlan({ cwd, name: 'loose-package-path.md', body });
	const findings = await lintPlanStructure({ cwd, planPaths: [path], decisions: emptyDecisionsRecord() });

	// the unidentifiable package path is flagged, got: ${JSON.stringify(findings)}
	expect(findings.some((finding) => finding.check === StructuralCheck.PackagesIdentifiable && finding.issue.includes("'packages/loose.ts'"))).toBeTruthy();
});

test('lintPlanStructure: a configured packagesDir moves the package-segment check off the default', async () => {
	const cwd = setupConsumerRepo();

	const config = LightsoutConfig.parse({ gates: { check: 'true', test: 'true', 'test-coverage': false }, 'packages-dir': 'modules' });
	const body = packagePlan({ modifyPath: 'modules/loose.ts', command: 'true' });
	const path = writePlan({ cwd, name: 'custom-packages-dir.md', body });
	const findings = await lintPlanStructure({ cwd, planPaths: [path], decisions: emptyDecisionsRecord(), config });

	// the configured packages directory drives the check, got:
	// ${JSON.stringify(findings)}
	expect(findings.some((finding) => finding.check === StructuralCheck.PackagesIdentifiable && finding.issue.includes('directly under modules/'))).toBeTruthy();
});

test('lintPlanStructure: an overview.md basename is the overview variant on its own', async () => {
	const cwd = setupConsumerRepo();
	const path = writePlan({
		cwd,
		name: 'overview.md',
		body: `# Plain Title

## Global Constraints

- None
`,
	});

	const findings = await lintPlanStructure({ cwd, planPaths: [path], decisions: emptyDecisionsRecord() });
	const sections = findings.filter((finding) => finding.check === StructuralCheck.SectionsPresent);

	// the filename alone selects the overview section set
	expect(sections.map((finding) => finding.issue)).toStrictEqual([
		"missing required section '## Phases' (overview plan)",
		"missing required section '## Phase Declarations' (overview plan)",
		"missing required section '## Cross-Phase Dependencies' (overview plan)",
	]);
});

test('lintPlanStructure: a plan file that cannot be read is a finding, not a silent pass', async () => {
	const cwd = setupConsumerRepo();
	const planPath = join(cwd, 'unreadable-plan.md');

	// a directory standing where the plan should be: the draft claimed a path
	// that holds no text, and a clean lint would let that through as structural
	mkdirSync(planPath);

	const findings = await lintPlanStructure({ cwd, planPaths: [planPath], decisions: emptyDecisionsRecord() });

	expect(findings.map(({ issue, location }) => ({ issue, location }))).toStrictEqual([{ issue: 'plan file could not be read', location: planPath }]);
	expect(findings[0]?.fix).toMatch(/ensure the draft wrote the plan file/);
});

/** The merged record a plan named `demo` was drafted from, carrying one settled row. */
const oneRowRecord = (): DecisionsRecord => ({
	planName: 'demo',
	decisions: [
		{
			source: DecisionSource.Elicitation,
			question: 'where does the complete decision history live?',
			options: 'the overview alone / a table in every phase file',
			choice: 'the overview alone',
			rationale: 'one table to keep in step with the record',
			assumption: false,
		},
	],
});

test('lintPlanStructure: a plan whose Decision Log disagrees with the record is reported against that file', async () => {
	const cwd = setupConsumerRepo();
	const path = writePlan({ cwd, name: 'stale-log.md', body: planWith({ snippet: 'It replaces `src/ghost.ts`, which moved months ago.' }) });

	const findings = await lintPlanStructure({ cwd, planPaths: [path], decisions: oneRowRecord() });
	const stale = findings.filter((finding) => finding.check === StructuralCheck.DecisionLogCurrent);

	// the body carries the section rendered from an empty record, so the one
	// settled row is missing from it, got: ${JSON.stringify(findings)}
	expect(stale.length).toBe(1);
	expect(stale[0]?.severity).toBe(FindingSeverity.Blocking);
	// the finding belongs to the file whose section is stale, and points at the
	// line the section starts on
	expect(stale[0]?.phase).toBe('stale-log.md');
	expect(stale[0]?.location ?? '').toMatch(/^stale-log\.md:\d+$/);
	// the remedy is the sync command, named for the plan the record belongs to
	expect(stale[0]?.fix ?? '').toContain('plan sync-decisions --name demo');
	// the file's other defect is still reported beside it — a stale log does not
	// swallow the rest of the lint
	expect(findings.some((finding) => finding.check === StructuralCheck.ProsePathExists)).toBeTruthy();
});

test("lintPlanStructure: the clean plan's rendered Decision Log passes the currency check", async () => {
	const cwd = setupConsumerRepo();
	const path = writePlan({ cwd, name: 'current-log.md', body: cleanPlanBody() });

	const findings = await lintPlanStructure({ cwd, planPaths: [path], decisions: emptyDecisionsRecord() });

	// the fixture's section is exactly what the renderer produces from an empty
	// record, so there is nothing to sync
	expect(findings.filter((finding) => finding.check === StructuralCheck.DecisionLogCurrent)).toStrictEqual([]);
	// and the plan is still clean everywhere else, got: ${JSON.stringify(findings)}
	expect(findings).toStrictEqual([]);
});
