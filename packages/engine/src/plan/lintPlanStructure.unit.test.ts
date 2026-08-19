import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';
import { LightsoutConfig, StructuralCheck } from '@/contracts';
import { lintPlanStructure } from '@/plan';

/** Write a plan file into a plan's own folder and return its absolute path. */
const writePlan = ({ cwd, name, body }: { cwd: string; name: string; body: string }) => {
	const dir = join(cwd, '.lightsout', 'plans', 'demo');

	mkdirSync(dir, { recursive: true });

	const path = join(dir, name);

	writeFileSync(path, body);

	return path;
};

/** A structurally clean single/phase plan whose paths resolve against setupConsumerRepo. */
const cleanPlan = () => `# Clean Plan

## Context

A tiny clean plan for the structural lint.

## Global Constraints

- None

## Prerequisites

- None

## Files to Create

### \`src/new-thing.ts\`

A new module exporting \`newThing\`.

## Files to Modify

### \`src/index.js\`

Re-export \`newThing\`.

## Patterns to Mirror

- \`src/index.js\` — mirror its single-export shape.

## Prior Art

- \`newThing\` — searched newThing/new-thing, found none (new).

## Scope Boundaries

**Do:**
- Add \`newThing\`.

**Do NOT:**
- Touch anything else.

## Verification

- \`true\` — types clean

## What Next Plan Expects

None — standalone plan.
`;

test('lintPlanStructure: a missing "What Next Plan Expects" section is flagged', async () => {
	const cwd = setupConsumerRepo();
	const path = writePlan({
		cwd,
		name: 'no-next.md',
		body: `# Plan

## Prerequisites

- None

## Files to Modify

### \`src/index.js\`

Change it.

## Scope Boundaries

**Do NOT:** wander.

## Verification

- \`true\` — types clean
`,
	});

	const findings = await lintPlanStructure({ cwd, planPaths: [path] });

	// the missing section is flagged
	expect(findings.some((finding) => finding.check === StructuralCheck.SectionsPresent && finding.issue.includes('What Next Plan Expects'))).toBeTruthy();
});

test('lintPlanStructure: a missing "Global Constraints" section is flagged on an implementable plan', async () => {
	const cwd = setupConsumerRepo();
	const path = writePlan({
		cwd,
		name: 'no-constraints.md',
		body: `# Plan

## Prerequisites

- None

## Files to Modify

### \`src/index.js\`

Change it.

## Scope Boundaries

**Do NOT:** wander.

## Verification

- \`true\` — types clean

## What Next Plan Expects

None.
`,
	});

	const findings = await lintPlanStructure({ cwd, planPaths: [path] });

	// the missing section is flagged
	expect(findings.some((finding) => finding.check === StructuralCheck.SectionsPresent && finding.issue.includes('Global Constraints'))).toBeTruthy();
});

test('lintPlanStructure: a missing "Global Constraints" section is flagged on an overview plan', async () => {
	const cwd = setupConsumerRepo();
	const path = writePlan({
		cwd,
		name: 'overview-no-constraints.md',
		body: `# Plan — Overview

## Context

An overview without the constraints section.

## Phases

| # | File | Scope |
|---|------|-------|
| 1 | \`phase1-core.md\` | the core |

## Cross-Phase Dependencies

- None.
`,
	});

	const findings = await lintPlanStructure({ cwd, planPaths: [path] });

	// the missing section is flagged on the overview variant
	expect(
		findings.some(
			(finding) => finding.check === StructuralCheck.SectionsPresent && finding.issue.includes('Global Constraints') && finding.issue.includes('overview'),
		),
	).toBeTruthy();
});

test('lintPlanStructure: a 60-file plan trips ScopeWithinGuardrail', async () => {
	const cwd = setupConsumerRepo();
	const creates = Array.from({ length: 60 }, (_, index) => `### \`src/gen${index}.ts\`\n\nGenerated module ${index}.\n`).join('\n');
	const path = writePlan({
		cwd,
		name: 'too-big.md',
		body: `# Plan

## Prerequisites

- None

## Files to Create

${creates}

## Scope Boundaries

**Do NOT:** wander.

## Verification

- \`true\` — types clean

## What Next Plan Expects

None.
`,
	});

	const findings = await lintPlanStructure({ cwd, planPaths: [path] });

	// the oversized plan is flagged
	expect(findings.some((finding) => finding.check === StructuralCheck.ScopeWithinGuardrail)).toBeTruthy();
});

test('lintPlanStructure: a clean plan returns no findings', async () => {
	const cwd = setupConsumerRepo();
	const path = writePlan({ cwd, name: 'clean.md', body: cleanPlan() });

	const findings = await lintPlanStructure({ cwd, planPaths: [path] });

	// clean plan should have no findings, got: ${JSON.stringify(findings)}
	expect(findings).toStrictEqual([]);
});

/** The clean plan with a snippet standing in for its Context prose. */
const planWith = ({ snippet }: { snippet: string }) => cleanPlan().replace('A tiny clean plan for the structural lint.', snippet);

test('lintPlanStructure: fence state resets per file — an unclosed fence never silences the next plan', async () => {
	const cwd = setupConsumerRepo();
	const unclosed = writePlan({ cwd, name: 'unclosed-fence.md', body: planWith({ snippet: '```ts\nconst {userName} = props;' }) });
	const following = writePlan({ cwd, name: 'after-fence.md', body: planWith({ snippet: 'Resolve the {token} before writing.' }) });

	const findings = await lintPlanStructure({ cwd, planPaths: [unclosed, following] });
	const placeholders = findings.filter((finding) => finding.check === StructuralCheck.NoPlaceholders);

	// only the second plan's prose token is flagged, got:
	// ${JSON.stringify(placeholders)}
	expect(placeholders.length).toBe(1);
	// the finding is attributed to the second plan
	expect(placeholders[0].location.startsWith('after-fence.md:')).toBeTruthy();
});

/** A plan whose only lint-relevant content is one modify path and one verification command. */
const packagePlan = ({ modifyPath, command }: { modifyPath: string; command: string }) => `# Plan

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
	const findings = await lintPlanStructure({ cwd, planPaths: [path] });

	// the unidentifiable package path is flagged, got: ${JSON.stringify(findings)}
	expect(findings.some((finding) => finding.check === StructuralCheck.PackagesIdentifiable && finding.issue.includes("'packages/loose.ts'"))).toBeTruthy();
});

test('lintPlanStructure: a configured packagesDir moves the package-segment check off the default', async () => {
	const cwd = setupConsumerRepo();

	const config = LightsoutConfig.parse({ gates: { check: 'true', test: 'true', 'test-coverage': false }, 'packages-dir': 'modules' });
	const body = packagePlan({ modifyPath: 'modules/loose.ts', command: 'true' });
	const path = writePlan({ cwd, name: 'custom-packages-dir.md', body });
	const findings = await lintPlanStructure({ cwd, planPaths: [path], config });

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

	const findings = await lintPlanStructure({ cwd, planPaths: [path] });
	const sections = findings.filter((finding) => finding.check === StructuralCheck.SectionsPresent);

	// the filename alone selects the overview section set
	expect(sections.map((finding) => finding.issue)).toStrictEqual([
		"missing required section '## Phases' (overview plan)",
		"missing required section '## Cross-Phase Dependencies' (overview plan)",
	]);
});

test('lintPlanStructure: a plan file that cannot be read is a finding, not a silent pass', async () => {
	const cwd = setupConsumerRepo();
	const planPath = join(cwd, 'unreadable-plan.md');

	// a directory standing where the plan should be: the draft claimed a path
	// that holds no text, and a clean lint would let that through as structural
	mkdirSync(planPath);

	const findings = await lintPlanStructure({ cwd, planPaths: [planPath] });

	expect(findings.map(({ issue, location }) => ({ issue, location }))).toStrictEqual([{ issue: 'plan file could not be read', location: planPath }]);
	expect(findings[0]?.fix).toMatch(/ensure the draft wrote the plan file/);
});
