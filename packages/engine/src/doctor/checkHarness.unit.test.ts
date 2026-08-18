import { describe, expect, test } from '@jest/globals';
import type { LightsoutConfig } from '@/contracts';
import { checkHarness } from '@/doctor/checkHarness';

const gates: LightsoutConfig['gates'] = { check: 'true', test: 'true', testCoverage: false };

/** A config referencing whichever harnesses the case names — the probe seam keeps every binary imaginary. */
const setupConfig = ({ harness, commands }: Pick<LightsoutConfig, 'harness' | 'commands'> = {}): LightsoutConfig => ({ gates, harness, commands });

describe('checkHarness', () => {
	test('flags a broken harness binary with the probe output', async () => {
		const check = await checkHarness({
			cwd: '/repo',
			config: setupConfig(),
			probeHarness: async () => ({ exitCode: 1, stdout: '', stderr: 'spawn codex ENOENT' }),
		});

		expect(check.status).toBe('fail');
		expect(check.detail).toMatch(/ENOENT/);
	});

	test('probes every binary the commands block references and names the broken one', async () => {
		const check = await checkHarness({
			cwd: '/repo',
			config: setupConfig({ commands: { improve: { harness: 'codex' } } }),
			probeHarness: async ({ binary }) =>
				binary === 'claude' ? { exitCode: 0, stdout: '2.1.201 (Claude Code)\n', stderr: '' } : { exitCode: 1, stdout: '', stderr: `spawn ${binary} ENOENT` },
		});

		// a per-command harness whose binary is broken fails the check even when
		// the global binary is healthy, and the fix names the broken one
		expect(check.status).toBe('fail');
		expect(check.detail).toMatch(/codex/);
		expect(check.fix ?? '').toMatch(/codex/);
	});

	test('reports a binary whose probe throws as not runnable, with an install fix', async () => {
		const check = await checkHarness({
			cwd: '/repo',
			config: setupConfig(),
			probeHarness: async () => {
				throw new Error('spawn claude EACCES');
			},
		});

		expect(check.status).toBe('fail');
		expect(check.detail).toMatch(/claude not runnable: spawn claude EACCES/);
		// a binary that cannot even spawn gets the install fix, not the repair fix
		expect(check.fix ?? '').toMatch(/install/);
	});

	test('probes each referenced binary once, even when several commands name the same harness', async () => {
		const probedBinaries: string[] = [];
		const check = await checkHarness({
			cwd: '/repo',
			config: setupConfig({ commands: { implement: { harness: 'codex' }, refactor: { harness: 'codex' }, improve: { harness: 'claude-code' } } }),
			probeHarness: async ({ binary }) => {
				probedBinaries.push(binary);

				return { exitCode: 0, stdout: '1.0.0\n', stderr: '' };
			},
		});

		expect(check.status).toBe('pass');
		// duplicate harness references collapse to one probe per binary
		expect([...probedBinaries].sort()).toStrictEqual(['claude', 'codex']);
	});

	test('probes the binary the global harness key names, not the claude-code default', async () => {
		const probedBinaries: string[] = [];
		const check = await checkHarness({
			cwd: '/repo',
			config: setupConfig({ harness: 'codex' }),
			probeHarness: async ({ binary }) => {
				probedBinaries.push(binary);

				return { exitCode: 0, stdout: '0.146.0\n', stderr: '' };
			},
		});

		// a global harness replaces the default rather than adding to it
		expect(probedBinaries).toStrictEqual(['codex']);
		expect(check.status).toBe('pass');
		expect(check.detail).toMatch(/codex 0\.146\.0/);
	});

	test('probes both the global harness and a command that overrides it', async () => {
		const probedBinaries: string[] = [];
		const check = await checkHarness({
			cwd: '/repo',
			config: setupConfig({ harness: 'codex', commands: { plan: { harness: 'claude-code' } } }),
			probeHarness: async ({ binary }) => {
				probedBinaries.push(binary);

				return { exitCode: 0, stdout: '1.0.0\n', stderr: '' };
			},
		});

		// every harness some command resolves to is probed
		expect([...probedBinaries].sort()).toStrictEqual(['claude', 'codex']);
		expect(check.status).toBe('pass');
	});

	test('probes an unknown harness name as its own binary name — getDriver, not the doctor, owns rejecting it', async () => {
		const check = await checkHarness({
			cwd: '/repo',
			config: setupConfig({ commands: { improve: { harness: 'my-harness' } } }),
			probeHarness: async ({ binary }) =>
				binary === 'my-harness' ? { exitCode: 1, stdout: '', stderr: 'spawn my-harness ENOENT' } : { exitCode: 0, stdout: '2.1.201\n', stderr: '' },
		});

		expect(check.status).toBe('fail');
		// a harness name with no binary mapping is probed under its own name
		expect(check.detail).toMatch(/my-harness/);
	});

	test('passes when every referenced binary probes green, naming each version', async () => {
		const check = await checkHarness({
			cwd: '/repo',
			config: setupConfig({ commands: { improve: { harness: 'codex' } } }),
			probeHarness: async ({ binary }) => ({ exitCode: 0, stdout: `${binary === 'claude' ? '2.1.201 (Claude Code)' : '0.128.0'}\n`, stderr: '' }),
		});

		expect(check.status).toBe('pass');
		expect(check.detail).toMatch(/claude 2\.1\.201/);
		expect(check.detail).toMatch(/codex 0\.128\.0/);
	});
});
