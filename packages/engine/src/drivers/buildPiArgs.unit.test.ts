import { expect, test } from '@jest/globals';
import { Permissions } from '#src/contracts/index.ts';
import { buildPiArgs } from '#src/drivers/index.ts';

test('buildPiArgs: the base argv is print mode, the json event stream, and no session — nothing else is forced', () => {
	expect(buildPiArgs({ variant: 'pi' })).toStrictEqual(['-p', '--mode', 'json', '--no-session']);
	expect(buildPiArgs({ variant: 'omp' })).toStrictEqual(['-p', '--mode', 'json', '--no-session']);
});

test('buildPiArgs: the system prompt rides a file path, not argv — the harness appends the file’s contents', () => {
	const args = buildPiArgs({ variant: 'omp', systemPromptPath: '/tmp/sp.md' });

	expect(args.slice(-2)).toStrictEqual(['--append-system-prompt', '/tmp/sp.md']);
});

test('buildPiArgs: the model and the shared effort level pass through as their own harness flags', () => {
	const args = buildPiArgs({ variant: 'pi', model: 'zai/glm-5.3', effort: 'high' });

	expect(args[args.indexOf('--model') + 1]).toBe('zai/glm-5.3');
	expect(args.slice(-2)).toStrictEqual(['--thinking', 'high']);
});

test('buildPiArgs: read-only is the inspection-tool allowlist, naming each variant’s own toolset', () => {
	const pi = buildPiArgs({ variant: 'pi', permissions: Permissions.ReadOnly });
	const omp = buildPiArgs({ variant: 'omp', permissions: Permissions.ReadOnly });

	// pi names its find; omp renamed it glob and added lsp
	expect(pi.slice(-2)).toStrictEqual(['--tools', 'read,grep,find,ls']);
	expect(omp.slice(-2)).toStrictEqual(['--tools', 'read,grep,glob,lsp']);
});

test('buildPiArgs: omp maps write and full-access onto its approval tiers', () => {
	const write = buildPiArgs({ variant: 'omp', permissions: Permissions.Write });
	const full = buildPiArgs({ variant: 'omp', permissions: Permissions.FullAccess });

	expect(write.slice(-2)).toStrictEqual(['--approval-mode', 'write']);
	expect(full.slice(-2)).toStrictEqual(['--approval-mode', 'yolo']);
});

test('buildPiArgs: bare pi has no permission system — write and full-access add no flag, so intent stays prompt-level', () => {
	const write = buildPiArgs({ variant: 'pi', permissions: Permissions.Write });
	const full = buildPiArgs({ variant: 'pi', permissions: Permissions.FullAccess });

	expect(write).toStrictEqual(['-p', '--mode', 'json', '--no-session']);
	expect(full).toStrictEqual(['-p', '--mode', 'json', '--no-session']);
});

test('buildPiArgs: no granted-commands flag exists on either variant — the binding grant is the prompt-level list', () => {
	// allowedCommands deliberately has no argv mapping: omp's bash.patterns
	// overlay would replace the user's own rules, which is not additive
	const pi = buildPiArgs({ variant: 'pi', permissions: Permissions.FullAccess, model: 'm' });
	const omp = buildPiArgs({ variant: 'omp', permissions: Permissions.Write, model: 'm' });

	expect(pi.some((arg) => arg.includes('allow') || arg.includes('config'))).toBe(false);
	expect(omp.some((arg) => arg.includes('allow') || arg.includes('config'))).toBe(false);
});
