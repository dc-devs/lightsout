import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildFeatureExecutorInvocation } from './index';

const planContent = '# Plan: add the widget flag\n\nPLAN-SENTINEL';
const overviewContent = '# Overview\n\nOVERVIEW-SENTINEL';
const standards = '## Tabs only\n\nSTANDARDS-SENTINEL';
const allowedCommands = ['pnpm --filter api run prisma:migrate:dev:name'];

test('buildFeatureExecutorInvocation: the system prompt carries role, overview, plan, standards, and granted commands in that order', () => {
	const { systemPrompt } = buildFeatureExecutorInvocation({ planContent, overviewContent, standards, allowedCommands });

	assert.ok(systemPrompt.startsWith('# Role: Feature Executor'), 'the role prompt leads the system prompt');
	assert.ok(systemPrompt.includes(`# Overview (high-level context)`));
	assert.ok(systemPrompt.includes(`# Plan\n\n${planContent}`));
	assert.ok(systemPrompt.includes(`# Standards\n\nThese rules are binding for every line you write:\n\n${standards}`));
	assert.ok(systemPrompt.includes(`# Granted commands\n\nYou may run these shell commands`));
	assert.ok(systemPrompt.includes(`- \`${allowedCommands[0]}\``), 'the grant lists the exact prefix');
	assert.ok(
		systemPrompt.indexOf('# Overview (high-level context)') < systemPrompt.indexOf('# Plan\n\n') &&
			systemPrompt.indexOf('# Plan\n\n') < systemPrompt.indexOf('# Standards\n\n') &&
			systemPrompt.indexOf('# Standards\n\n') < systemPrompt.indexOf('# Granted commands\n\nYou may run these shell commands'),
		'section order is deterministic',
	);
});

test('buildFeatureExecutorInvocation: optional sections are omitted when their input is absent or empty', () => {
	const { systemPrompt } = buildFeatureExecutorInvocation({ planContent, allowedCommands: [] });

	assert.ok(!systemPrompt.includes('# Overview (high-level context)'), 'no overview section for an unphased plan');
	assert.ok(!systemPrompt.includes('# Standards\n\nThese rules are binding'), 'no standards section when standards are absent');
	assert.ok(!systemPrompt.includes('# Granted commands\n\nYou may run these shell commands'), 'an empty grant list emits no grant section');
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

	assert.equal(first.systemPrompt, retry.systemPrompt, 'the fix-retry variables cannot break the cached prefix');
});

test('buildFeatureExecutorInvocation: a first spawn user prompt is the report reminder alone — everything else is in the system prompt', () => {
	const { prompt } = buildFeatureExecutorInvocation({ planContent, overviewContent, standards, allowedCommands });

	assert.equal(prompt, 'Remember: your entire final message must be exactly one JSON report object — nothing else.');
});

test('buildFeatureExecutorInvocation: the fix-retry sections ride the user prompt, each only when its input is present', () => {
	const { prompt } = buildFeatureExecutorInvocation({ planContent, changedFiles: ['src/widget.ts'], errorContext: 'GATE-SENTINEL' });

	assert.ok(prompt.startsWith('# Previously changed files'));
	assert.ok(prompt.includes('- src/widget.ts'));
	assert.ok(prompt.includes('# Verification failure'));
	assert.ok(prompt.includes('GATE-SENTINEL'), 'the gate output lands verbatim');
	assert.ok(prompt.includes('one JSON report object'), 'the report-contract reminder closes the prompt');
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

	assert.ok(!prompt.includes('PLAN-SENTINEL'));
	assert.ok(!prompt.includes('OVERVIEW-SENTINEL'));
	assert.ok(!prompt.includes('STANDARDS-SENTINEL'));
	assert.ok(!prompt.includes('# Granted commands'));
});
