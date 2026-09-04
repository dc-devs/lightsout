import { expect, test } from '@jest/globals';
import { buildUnitTestWriterInvocation } from '#src/agents/index.ts';

const planContent = '# Plan: add the widget flag\n\nPLAN-SENTINEL';
const standards = '## Tabs only\n\nSTANDARDS-SENTINEL';
const soloParams = { planContent, subjects: ['src/widget.ts'], mustExecute: ['src/widget.ts'] };

test('buildUnitTestWriterInvocation: the system prompt carries the role, the plan, and the standards as labelled sections', () => {
	const { systemPrompt } = buildUnitTestWriterInvocation({ ...soloParams, standards });

	// the role prompt leads the system prompt
	expect(systemPrompt.startsWith('# Role: Unit Test Writer')).toBeTruthy();
	// the plan is appended as a labelled section
	expect(systemPrompt.includes(`\n\n---\n\n# Plan (context for intended behavior)\n\n${planContent}`)).toBeTruthy();
	// the standards land verbatim
	expect(systemPrompt.includes(`# Standards\n\nThese rules are binding for the tests you write:\n\n${standards}`)).toBeTruthy();
});

test('buildUnitTestWriterInvocation: no standards section when standards are absent', () => {
	const { systemPrompt } = buildUnitTestWriterInvocation(soloParams);

	// the standards section is omitted, not emptied
	expect(systemPrompt.includes('# Standards\n\nThese rules are binding')).toBeFalsy();
});

test('buildUnitTestWriterInvocation: the system prompt is byte-identical across the spawns of one fan-out', () => {
	const first = buildUnitTestWriterInvocation({ ...soloParams, standards });
	const second = buildUnitTestWriterInvocation({
		planContent,
		subjects: ['src/other.ts'],
		mustExecute: ['src/other.ts', 'src/internal.ts'],
		standards,
	});
	const fix = buildUnitTestWriterInvocation({ ...soloParams, standards, errorContext: 'test-unit failed' });

	// a different assignment cannot break the cached prefix
	expect(first.systemPrompt).toBe(second.systemPrompt);
	// a fix re-invocation shares the writers cached prefix
	expect(first.systemPrompt).toBe(fix.systemPrompt);
});

test('buildUnitTestWriterInvocation: the user prompt carries the two lists, the binding assignment rules, and the report reminder', () => {
	const { prompt } = buildUnitTestWriterInvocation({
		planContent,
		subjects: ['src/widget/index.ts'],
		mustExecute: ['src/widget/helper.ts', 'src/widget/widget.ts'],
		standards,
	});

	// the role marker the engine classifies on leads the prompt
	expect(prompt.startsWith('# Test subjects — write tests through these public surfaces\n\n- src/widget/index.ts')).toBeTruthy();
	// every must-execute file gets its own bullet under its own section
	expect(prompt.includes('# Changed internals that must execute under those tests\n\n- src/widget/helper.ts\n- src/widget/widget.ts')).toBeTruthy();
	// the assignment rules are always present: no test file outside the subjects list…
	expect(prompt.includes('Never create a test file for any file outside the subjects list')).toBeTruthy();
	// …an unchanged subject is still the path to its changed internals…
	expect(prompt.includes('A subject listed here may be unchanged')).toBeTruthy();
	// …and the engine's executed check is announced
	expect(prompt.includes('The engine will verify, from the coverage report, that every changed file listed above executed under the tests')).toBeTruthy();
	// the report-contract reminder closes the prompt
	expect(prompt.includes('one JSON report object')).toBeTruthy();
});

test('buildUnitTestWriterInvocation: the verification-failure section rides the user prompt, only on a fix re-invocation', () => {
	const clean = buildUnitTestWriterInvocation(soloParams);
	const fix = buildUnitTestWriterInvocation({ ...soloParams, errorContext: 'GATE-SENTINEL' });

	expect(clean.prompt.includes('# Verification failure')).toBeFalsy();
	expect(fix.prompt.includes('# Verification failure')).toBeTruthy();
	// the gate output lands verbatim
	expect(fix.prompt.includes('GATE-SENTINEL')).toBeTruthy();
});

test('buildUnitTestWriterInvocation: neither the plan nor the standards appear in the user prompt', () => {
	const { prompt } = buildUnitTestWriterInvocation({ ...soloParams, standards });

	// the plan is paid for once, in the cached system prompt
	expect(prompt.includes('PLAN-SENTINEL')).toBeFalsy();
	// the standards are paid for once, in the cached system prompt
	expect(prompt.includes('STANDARDS-SENTINEL')).toBeFalsy();
});

test('buildUnitTestWriterInvocation: the system prompt fences its sections with a horizontal rule, in a deterministic order', () => {
	const { systemPrompt } = buildUnitTestWriterInvocation({ ...soloParams, standards });

	// the standards are fenced off from the plan
	expect(systemPrompt.includes('\n\n---\n\n# Standards\n\n')).toBeTruthy();
	// section order is role, then plan, then standards
	expect(systemPrompt.indexOf('# Plan (context for intended behavior)') < systemPrompt.indexOf('\n\n---\n\n# Standards\n\n')).toBeTruthy();
});

test('buildUnitTestWriterInvocation: the plan section survives, fenced, when no standards are supplied', () => {
	const { systemPrompt } = buildUnitTestWriterInvocation(soloParams);

	// the plan closes a standards-free system prompt, still fenced off from the
	// role
	expect(systemPrompt.endsWith(`\n\n---\n\n# Plan (context for intended behavior)\n\n${planContent}`)).toBeTruthy();
});

test('buildUnitTestWriterInvocation: empty optional inputs emit no section rather than an empty one', () => {
	const { systemPrompt, prompt } = buildUnitTestWriterInvocation({ ...soloParams, standards: '', errorContext: '' });

	// an empty standards string emits no standards section
	expect(systemPrompt.includes('# Standards\n\nThese rules are binding')).toBeFalsy();
	// an empty error context emits no verification-failure section
	expect(prompt.includes('# Verification failure')).toBeFalsy();
});

test('buildUnitTestWriterInvocation: a solo assignment user prompt is the two lists, the rules, and the report reminder alone', () => {
	const { prompt } = buildUnitTestWriterInvocation({ ...soloParams, standards });

	expect(prompt).toBe(
		[
			'# Test subjects — write tests through these public surfaces\n\n- src/widget.ts',
			'# Changed internals that must execute under those tests\n\n- src/widget.ts',
			[
				'Rules for this assignment:',
				"- Never create a test file for any file outside the subjects list — an internal file's coverage is earned through the public surface that owns it, never through a dedicated test.",
				"- A subject listed here may be unchanged: it is listed because a changed internal is reached through it. Test the subject's observable behavior so the changed internals execute.",
				'- The engine will verify, from the coverage report, that every changed file listed above executed under the tests — a changed file that never runs fails the verification gate.',
			].join('\n'),
			'Remember: your entire final message must be exactly one JSON report object — nothing else.',
		].join('\n\n'),
	);
});

test('buildUnitTestWriterInvocation: the report reminder closes the user prompt, after the verification failure', () => {
	const { prompt } = buildUnitTestWriterInvocation({ ...soloParams, errorContext: 'GATE-SENTINEL' });

	// the subject list still leads a fix re-invocation
	expect(prompt.startsWith('# Test subjects — write tests through these public surfaces')).toBeTruthy();
	// the gate output follows the assignment
	expect(prompt.indexOf('# Verification failure') > prompt.indexOf('- src/widget.ts')).toBeTruthy();
	// the report-contract reminder closes the prompt
	expect(prompt.endsWith('Remember: your entire final message must be exactly one JSON report object — nothing else.')).toBeTruthy();
});

test('buildUnitTestWriterInvocation: empty lists emit their headers with no bullets', () => {
	const { prompt } = buildUnitTestWriterInvocation({ planContent, subjects: [], mustExecute: [], standards });

	// the role marker the engine classifies on still leads the prompt
	expect(prompt.startsWith('# Test subjects — write tests through these public surfaces')).toBeTruthy();
	// no bullet is emitted for an empty list — the assignment rules keep their
	// own bullets, so only the region above them is inspected
	expect(prompt.slice(0, prompt.indexOf('Rules for this assignment:')).includes('\n- ')).toBeFalsy();
});

test('buildUnitTestWriterInvocation: the locked ledger test files ride the user prompt, with the sibling rule', () => {
	const clean = buildUnitTestWriterInvocation(soloParams);
	const locked = buildUnitTestWriterInvocation({ ...soloParams, ledgerTests: ['src/widget.unit.test.ts'] });

	// a run whose plan carries no ledger gets no section at all
	expect(clean.prompt.includes('# Ledger tests (read-only)')).toBeFalsy();
	expect(buildUnitTestWriterInvocation({ ...soloParams, ledgerTests: [] }).prompt.includes('# Ledger tests (read-only)')).toBeFalsy();
	// each locked path gets its own bullet
	expect(locked.prompt.includes('# Ledger tests (read-only)\n\n- src/widget.unit.test.ts')).toBeTruthy();
	// a coverage case that belongs in a locked file has somewhere writable to go
	expect(locked.prompt.includes('a sibling file beside the same subject')).toBeTruthy();
	// the report-contract reminder still closes the prompt
	expect(locked.prompt.endsWith('Remember: your entire final message must be exactly one JSON report object — nothing else.')).toBeTruthy();
});

test('buildUnitTestWriterInvocation: a fix re-invocation of a locked run lists every locked path, after the rules and before the gate output', () => {
	const { prompt } = buildUnitTestWriterInvocation({
		...soloParams,
		ledgerTests: ['src/widget.unit.test.ts', 'src/gadget.unit.test.ts'],
		errorContext: 'GATE-SENTINEL',
	});

	// every locked path gets its own bullet, in the order the manifest holds them
	expect(prompt.includes('# Ledger tests (read-only)\n\n- src/widget.unit.test.ts\n- src/gadget.unit.test.ts')).toBeTruthy();
	// the lock list follows the assignment rules it qualifies
	expect(prompt.indexOf('Rules for this assignment:') < prompt.indexOf('# Ledger tests (read-only)')).toBeTruthy();
	// and precedes the gate output, so the fix reads the lock before the failure
	expect(prompt.indexOf('# Ledger tests (read-only)') < prompt.indexOf('# Verification failure')).toBeTruthy();
	// the gate output still lands verbatim
	expect(prompt.includes('GATE-SENTINEL')).toBeTruthy();
});

test('buildUnitTestWriterInvocation: the ledger paths never enter the cached system prompt', () => {
	const first = buildUnitTestWriterInvocation({ ...soloParams, standards });
	const locked = buildUnitTestWriterInvocation({ ...soloParams, standards, ledgerTests: ['src/widget.unit.test.ts'] });

	// the fan-out's cached prefix is unchanged by a per-run lock list
	expect(first.systemPrompt).toBe(locked.systemPrompt);
});

test('buildUnitTestWriterInvocation: the role prompt bans editing a locked ledger test and names where the case goes instead', () => {
	const { systemPrompt } = buildUnitTestWriterInvocation(soloParams);
	// the prompt wraps its lines; the sentences are what matter
	const prose = systemPrompt.replace(/\s+/g, ' ');

	// the rule names the same section heading the user prompt emits
	expect(prose).toContain('Files listed under a `# Ledger tests (read-only)` section in your task are locked for the run');
	// editing is pointless, so the writer is told the engine reverts it
	expect(prose).toContain('the engine keeps a copy and reverts any change to them before verification');
	// a case that belongs in a locked file has a named, writable destination
	expect(prose).toContain('a sibling file beside the same subject whose name inserts `coverage` before the test suffix');
});

test('buildUnitTestWriterInvocation: the command ban names what is banned and leaves file access open — a harness whose only file access is a shell must not read it as "touch nothing"', () => {
	const { systemPrompt } = buildUnitTestWriterInvocation(soloParams);
	// the prompt wraps its lines; the sentences are what matter
	const prose = systemPrompt.replace(/\s+/g, ' ');

	// verification and environment changes stay the engine's alone
	expect(prose).toContain(
		'Do not run builds, tests, linters, formatters, package-manager commands, Git commands, network commands, or any other verification or environment-changing command',
	);
	// file inspection and editing are explicitly allowed, by whatever tooling the harness has
	expect(prose).toContain("Use the harness's file tools to read");
	expect(prose).toContain(
		'If the harness exposes the filesystem only through a shell, use the shell solely to inspect and edit files — never for repository commands.',
	);
	// the old blanket ban is gone — on Codex it read as "you cannot read or edit files"
	expect(prose).not.toContain('Do not run shell commands');
});
