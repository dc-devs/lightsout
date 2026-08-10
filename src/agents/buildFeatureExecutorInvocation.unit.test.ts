import { expect, test } from '@jest/globals';
import { buildFeatureExecutorInvocation } from '@/agents';

const planContent = '# Plan: add the widget flag\n\nPLAN-SENTINEL';
const overviewContent = '# Overview\n\nOVERVIEW-SENTINEL';
const standards = '## Tabs only\n\nSTANDARDS-SENTINEL';
const allowedCommands = ['pnpm --filter api run prisma:migrate:dev:name'];

test('buildFeatureExecutorInvocation: the system prompt carries role, overview, plan, standards, and granted commands in that order', () => {
	const { systemPrompt } = buildFeatureExecutorInvocation({ planContent, overviewContent, standards, allowedCommands });

	// the role prompt leads the system prompt
	expect(systemPrompt.startsWith('# Role: Feature Executor')).toBeTruthy();
	expect(systemPrompt.includes(`# Overview (high-level context)`)).toBeTruthy();
	expect(systemPrompt.includes(`# Plan\n\n${planContent}`)).toBeTruthy();
	expect(systemPrompt.includes(`# Standards\n\nThese rules are binding for every line you write:\n\n${standards}`)).toBeTruthy();
	expect(systemPrompt.includes(`# Granted commands\n\nYou may run these shell commands`)).toBeTruthy();
	// the grant lists the exact prefix
	expect(systemPrompt.includes(`- \`${allowedCommands[0]}\``)).toBeTruthy();
	// section order is deterministic
	expect(
		systemPrompt.indexOf('# Overview (high-level context)') < systemPrompt.indexOf('# Plan\n\n') &&
			systemPrompt.indexOf('# Plan\n\n') < systemPrompt.indexOf('# Standards\n\n') &&
			systemPrompt.indexOf('# Standards\n\n') < systemPrompt.indexOf('# Granted commands\n\nYou may run these shell commands'),
	).toBeTruthy();
});

test('buildFeatureExecutorInvocation: optional sections are omitted when their input is absent or empty', () => {
	const { systemPrompt } = buildFeatureExecutorInvocation({ planContent, allowedCommands: [] });

	// no overview section for an unphased plan
	expect(systemPrompt.includes('# Overview (high-level context)')).toBeFalsy();
	// no standards section when standards are absent
	expect(systemPrompt.includes('# Standards\n\nThese rules are binding')).toBeFalsy();
	// an empty grant list emits no grant section
	expect(systemPrompt.includes('# Granted commands\n\nYou may run these shell commands')).toBeFalsy();
});

test('buildFeatureExecutorInvocation: the system prompt is byte-identical across a fix retry', () => {
	const first = buildFeatureExecutorInvocation({ planContent, overviewContent, standards, allowedCommands });
	const retry = buildFeatureExecutorInvocation({
		planContent,
		overviewContent,
		standards,
		allowedCommands,
		changedFiles: ['src/widget.ts'],
		errorContext: 'check failed',
	});

	// the fix-retry variables cannot break the cached prefix
	expect(first.systemPrompt).toBe(retry.systemPrompt);
});

test('buildFeatureExecutorInvocation: a first spawn user prompt is the report reminder alone — everything else is in the system prompt', () => {
	const { prompt } = buildFeatureExecutorInvocation({ planContent, overviewContent, standards, allowedCommands });

	expect(prompt).toBe('Remember: your entire final message must be exactly one JSON report object — nothing else.');
});

test('buildFeatureExecutorInvocation: the fix-retry sections ride the user prompt, each only when its input is present', () => {
	const { prompt } = buildFeatureExecutorInvocation({ planContent, changedFiles: ['src/widget.ts'], errorContext: 'GATE-SENTINEL' });

	expect(prompt.startsWith('# Previously changed files')).toBeTruthy();
	expect(prompt.includes('- src/widget.ts')).toBeTruthy();
	expect(prompt.includes('# Verification failure')).toBeTruthy();
	// the gate output lands verbatim
	expect(prompt.includes('GATE-SENTINEL')).toBeTruthy();
	// the report-contract reminder closes the prompt
	expect(prompt.includes('one JSON report object')).toBeTruthy();
});

test('buildFeatureExecutorInvocation: an absent grant list emits no grant section', () => {
	const { systemPrompt } = buildFeatureExecutorInvocation({ planContent, standards });

	// a run that grants nothing carries no grant section
	expect(systemPrompt.includes('# Granted commands\n\nYou may run these shell commands')).toBeFalsy();
});

test('buildFeatureExecutorInvocation: every granted command gets its own backticked bullet', () => {
	const { systemPrompt } = buildFeatureExecutorInvocation({
		planContent,
		allowedCommands: ['pnpm --filter api run prisma:migrate:dev:name', 'pnpm run codegen'],
	});

	// the grants list one prefix per line, in the order given
	expect(systemPrompt.includes('- `pnpm --filter api run prisma:migrate:dev:name`\n- `pnpm run codegen`')).toBeTruthy();
});

test('buildFeatureExecutorInvocation: the system prompt separates its sections with a horizontal rule', () => {
	const { systemPrompt } = buildFeatureExecutorInvocation({ planContent, overviewContent, standards, allowedCommands });

	// the overview is fenced off from the role prompt
	expect(systemPrompt.includes('\n\n---\n\n# Overview (high-level context)')).toBeTruthy();
	// the plan is fenced off from the overview
	expect(systemPrompt.includes(`\n\n---\n\n# Plan\n\n${planContent}`)).toBeTruthy();
	// the standards are fenced off from the plan
	expect(systemPrompt.includes('\n\n---\n\n# Standards\n\n')).toBeTruthy();
	// the grants are fenced off from the standards
	expect(systemPrompt.includes('\n\n---\n\n# Granted commands\n\n')).toBeTruthy();
});

test('buildFeatureExecutorInvocation: an empty changed-file list emits no previously-changed section', () => {
	const { prompt } = buildFeatureExecutorInvocation({ planContent, changedFiles: [] });

	expect(prompt).toBe('Remember: your entire final message must be exactly one JSON report object — nothing else.');
});

test('buildFeatureExecutorInvocation: every previously changed file gets its own bullet', () => {
	const { prompt } = buildFeatureExecutorInvocation({ planContent, changedFiles: ['src/widget.ts', 'src/widget.unit.test.ts'] });

	// the cumulative file list is one bullet per file, in order
	expect(prompt.includes('- src/widget.ts\n- src/widget.unit.test.ts')).toBeTruthy();
});

test('buildFeatureExecutorInvocation: a fix re-invocation with no prior file list leads with the verification failure', () => {
	const { prompt } = buildFeatureExecutorInvocation({ planContent, errorContext: 'GATE-SENTINEL' });

	// the gate output leads when nothing changed earlier in the run
	expect(prompt.startsWith('# Verification failure')).toBeTruthy();
	// no empty previously-changed section is emitted
	expect(prompt.includes('# Previously changed files')).toBeFalsy();
	// the gate output lands verbatim
	expect(prompt.includes('GATE-SENTINEL')).toBeTruthy();
});

test('buildFeatureExecutorInvocation: none of the run-stable content leaks back into the user prompt', () => {
	const { prompt } = buildFeatureExecutorInvocation({
		planContent,
		overviewContent,
		standards,
		allowedCommands,
		changedFiles: ['src/widget.ts'],
		errorContext: 'check failed',
	});

	expect(prompt.includes('PLAN-SENTINEL')).toBeFalsy();
	expect(prompt.includes('OVERVIEW-SENTINEL')).toBeFalsy();
	expect(prompt.includes('STANDARDS-SENTINEL')).toBeFalsy();
	expect(prompt.includes('# Granted commands')).toBeFalsy();
});
