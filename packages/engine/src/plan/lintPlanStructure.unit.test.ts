import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { StructuralCheck } from '@lightsout/contracts';
import { lintPlanStructure } from './index';
import { setupConsumerRepo } from '../../tests/helpers/setupConsumerRepo';

/** Write a plan file into the repo and return its absolute path. */
const writePlan = ({ cwd, name, body }: { cwd: string; name: string; body: string }) => {
	const dir = join(cwd, '.claude', 'plans');

	mkdirSync(dir, { recursive: true });

	const path = join(dir, name);

	writeFileSync(path, body);

	return path;
};

/** A structurally clean single/phase plan whose paths resolve against setupConsumerRepo. */
const cleanPlan = () => `# Clean Plan

## Context

A tiny clean plan for the structural lint.

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

test('lintPlanStructure: a missing Files to Modify path is flagged', async () => {
	const cwd = setupConsumerRepo();
	const path = writePlan({
		cwd,
		name: 'missing-modify.md',
		body: `# Plan

## Prerequisites

- None

## Files to Modify

### \`src/does-not-exist.ts\`

Change something.

## Scope Boundaries

**Do NOT:** wander.

## Verification

- \`true\` — types clean

## What Next Plan Expects

None.
`,
	});

	const findings = await lintPlanStructure({ cwd, planPaths: [path] });

	assert.ok(
		findings.some((finding) => finding.check === StructuralCheck.PathExists && finding.issue.includes('src/does-not-exist.ts')),
		'the missing modify path is flagged',
	);
});

test('lintPlanStructure: a Files to Create path that already exists is flagged', async () => {
	const cwd = setupConsumerRepo();
	const path = writePlan({
		cwd,
		name: 'create-exists.md',
		body: `# Plan

## Prerequisites

- None

## Files to Create

### \`src/index.js\`

But this already exists.

## Scope Boundaries

**Do NOT:** wander.

## Verification

- \`true\` — types clean

## What Next Plan Expects

None.
`,
	});

	const findings = await lintPlanStructure({ cwd, planPaths: [path] });

	assert.ok(
		findings.some((finding) => finding.check === StructuralCheck.PathExists && finding.issue.includes('already exists')),
		'the create path that exists is flagged',
	);
});

test('lintPlanStructure: a TBD placeholder is flagged', async () => {
	const cwd = setupConsumerRepo();
	const path = writePlan({
		cwd,
		name: 'placeholder.md',
		body: `# Plan

## Prerequisites

- None

## Files to Modify

### \`src/index.js\`

Do TBD here.

## Scope Boundaries

**Do NOT:** wander.

## Verification

- \`true\` — types clean

## What Next Plan Expects

None.
`,
	});

	const findings = await lintPlanStructure({ cwd, planPaths: [path] });

	assert.ok(findings.some((finding) => finding.check === StructuralCheck.NoPlaceholders), 'the TBD is flagged');
});

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

	assert.ok(
		findings.some((finding) => finding.check === StructuralCheck.SectionsPresent && finding.issue.includes('What Next Plan Expects')),
		'the missing section is flagged',
	);
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

	assert.ok(findings.some((finding) => finding.check === StructuralCheck.ScopeWithinGuardrail), 'the oversized plan is flagged');
});

test('lintPlanStructure: a clean plan returns no findings', async () => {
	const cwd = setupConsumerRepo();
	const path = writePlan({ cwd, name: 'clean.md', body: cleanPlan() });

	const findings = await lintPlanStructure({ cwd, planPaths: [path] });

	assert.deepEqual(findings, [], `clean plan should have no findings, got: ${JSON.stringify(findings)}`);
});

/** The clean plan with a snippet standing in for its Context prose. */
const planWith = ({ snippet }: { snippet: string }) => cleanPlan().replace('A tiny clean plan for the structural lint.', snippet);

/** The NoPlaceholders findings a plan built around `snippet` produces. */
const placeholderFindings = async ({ name, snippet }: { name: string; snippet: string }) => {
	const cwd = setupConsumerRepo();
	const path = writePlan({ cwd, name, body: planWith({ snippet }) });
	const findings = await lintPlanStructure({ cwd, planPaths: [path] });

	return findings.filter((finding) => finding.check === StructuralCheck.NoPlaceholders);
};

test('lintPlanStructure: a template-literal interpolation inside a fenced block is not a placeholder', async () => {
	const findings = await placeholderFindings({
		name: 'fenced-interpolation.md',
		snippet: '```ts\nconst greeting = `hi ${userName}`;\n```',
	});

	assert.deepEqual(findings, [], `a fenced interpolation must not be flagged, got: ${JSON.stringify(findings)}`);
});

test('lintPlanStructure: a template-literal interpolation in prose is not a placeholder — the lookbehind covers it outside fences', async () => {
	const findings = await placeholderFindings({
		name: 'prose-interpolation.md',
		snippet: 'The writer interpolates `hi ${userName}` into the greeting.',
	});

	assert.deepEqual(findings, [], `a prose interpolation must not be flagged, got: ${JSON.stringify(findings)}`);
});

test('lintPlanStructure: destructuring inside a fenced block is not a placeholder', async () => {
	const findings = await placeholderFindings({
		name: 'fenced-destructuring.md',
		snippet: '```tsx\nconst {userName} = props;\n\nreturn <span>{userName}</span>;\n```',
	});

	assert.deepEqual(findings, [], `fenced code braces must not be flagged, got: ${JSON.stringify(findings)}`);
});

test('lintPlanStructure: a bare brace-token in prose is still flagged', async () => {
	const findings = await placeholderFindings({ name: 'prose-token.md', snippet: 'Resolve the {token} before writing.' });

	assert.equal(findings.length, 1, `the prose brace-token is flagged, got: ${JSON.stringify(findings)}`);
});

test('lintPlanStructure: a brace-token in an inline code span is still flagged — fences only, never spans', async () => {
	const findings = await placeholderFindings({ name: 'span-token.md', snippet: 'Place it at `packages/{package}/src/thing.ts`.' });

	assert.equal(findings.length, 1, `the inline-span brace-token is flagged, got: ${JSON.stringify(findings)}`);
});

test('lintPlanStructure: a TODO inside a fenced block is still flagged — fences suppress only the brace-token', async () => {
	const findings = await placeholderFindings({ name: 'fenced-todo.md', snippet: '```ts\n// TODO: decide later\n```' });

	assert.equal(findings.length, 1, `the fenced TODO is flagged, got: ${JSON.stringify(findings)}`);
});

test('lintPlanStructure: fence state resets per file — an unclosed fence never silences the next plan', async () => {
	const cwd = setupConsumerRepo();
	const unclosed = writePlan({ cwd, name: 'unclosed-fence.md', body: planWith({ snippet: '```ts\nconst {userName} = props;' }) });
	const following = writePlan({ cwd, name: 'after-fence.md', body: planWith({ snippet: 'Resolve the {token} before writing.' }) });

	const findings = await lintPlanStructure({ cwd, planPaths: [unclosed, following] });
	const placeholders = findings.filter((finding) => finding.check === StructuralCheck.NoPlaceholders);

	assert.equal(placeholders.length, 1, `only the second plan's prose token is flagged, got: ${JSON.stringify(placeholders)}`);
	assert.ok(placeholders[0].location.startsWith('after-fence.md:'), 'the finding is attributed to the second plan');
});

/** A minimal plan whose only lint-relevant content is one verification command. */
const verificationPlan = ({ command }: { command: string }) => `# Plan

## Prerequisites

- None

## Files to Modify

### \`src/index.js\`

Change something.

## Scope Boundaries

**Do NOT:** wander.

## Verification

- \`${command}\` — gates green

## What Next Plan Expects

None.
`;

test('lintPlanStructure: `pnpm --filter <pkg> run <script>` resolves the script, not the `run` token', async () => {
	const cwd = setupConsumerRepo();

	writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'consumer', scripts: { check: 'true' } }));

	const path = writePlan({ cwd, name: 'filter-run.md', body: verificationPlan({ command: 'pnpm --filter consumer run check' }) });
	const findings = await lintPlanStructure({ cwd, planPaths: [path] });

	assert.ok(
		!findings.some((finding) => finding.check === StructuralCheck.ScriptExists),
		`existing script behind --filter … run must not be flagged, got: ${JSON.stringify(findings)}`,
	);
});

test('lintPlanStructure: `pnpm -F <pkg> <script>` resolves the script, not the flag', async () => {
	const cwd = setupConsumerRepo();

	writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'consumer', scripts: { check: 'true' } }));

	const path = writePlan({ cwd, name: 'short-filter.md', body: verificationPlan({ command: 'pnpm -F consumer check' }) });
	const findings = await lintPlanStructure({ cwd, planPaths: [path] });

	assert.ok(
		!findings.some((finding) => finding.check === StructuralCheck.ScriptExists),
		`existing script behind -F must not be flagged, got: ${JSON.stringify(findings)}`,
	);
});

test('lintPlanStructure: a genuinely missing script behind --filter … run is still flagged', async () => {
	const cwd = setupConsumerRepo();

	writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'consumer', scripts: { check: 'true' } }));

	const path = writePlan({ cwd, name: 'filter-run-missing.md', body: verificationPlan({ command: 'pnpm --filter consumer run nope' }) });
	const findings = await lintPlanStructure({ cwd, planPaths: [path] });

	assert.ok(
		findings.some((finding) => finding.check === StructuralCheck.ScriptExists && finding.issue.includes("'nope'")),
		`missing script must be flagged by name, got: ${JSON.stringify(findings)}`,
	);
});
