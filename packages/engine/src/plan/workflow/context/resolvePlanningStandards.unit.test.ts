import { execFileSync } from 'node:child_process';
import { realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, jest, test } from '@jest/globals';
import { type LightsoutConfig, PlanningVocabulary } from '#src/contracts/index.ts';
import { resolvePlanningStandards } from '#src/plan/workflow/context/resolvePlanningStandards.ts';
import { planningEvidenceFixture } from '#tests/helpers/planningEvidenceFixture.ts';

const directories: string[] = [];
afterEach(async () => {
	for (const cwd of directories.splice(0)) await rm(cwd, { recursive: true, force: true });
});
const setup = async ({ fields = {}, packages = [] }: { fields?: Partial<LightsoutConfig>; packages?: string[] } = {}) => {
	const context = await planningEvidenceFixture();
	directories.push(context.cwd);
	await context.write('house/lightsout-standards.json', '{"name":"house","formatVersion":1}');
	await context.write('house/code/base/document.md', '# Base\nKeep public contracts stable.');
	await context.write('house/code/react/document.md', '---\nchannel: react\n---\n# React\nPreserve React state.');
	await context.write('house/code/nest/document.md', '---\nchannel: nestjs\n---\n# Nest\nPreserve dependency injection.');
	const config = { ...context.runtime.config, 'standards-packs': ['house'], ...fields };
	const scope = packages.length === 0 ? context.scope : { ...context.scope, kind: PlanningVocabulary.Scope.Selected, packageRoots: packages };
	return { ...context, config, scope, params: { cwd: context.cwd, config, scope, role: PlanningVocabulary.Role.Architect } };
};
test('rejects a missing explicitly scoped dependency manifest', async () => {
	const { params } = await setup({ packages: ['packages/missing'] });

	await expect(resolvePlanningStandards(params)).rejects.toThrow(/Required standards dependency manifest is missing/);
});
const setupFrameworkUnion = async () => {
	const context = await setup();
	await context.write('package.json', '{"dependencies":{"react":"1"}}');
	await context.write('packages/server/package.json', '{"dependencies":{"@nestjs/core":"1"}}');
	return context;
};
test('detects the union of root and child frameworks for a whole-plan scope', async () => {
	const { params } = await setupFrameworkUnion();

	const result = await resolvePlanningStandards(params);

	expect(result.content).toContain('Preserve React state.');
	expect(result.content).toContain('Preserve dependency injection.');
	expect(result.dependencies).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ path: 'package.json', kind: 'content' }),
			expect.objectContaining({ path: 'packages/server/package.json', kind: 'content' }),
		]),
	);
});
const setupOverride = async () => {
	const context = await setup({ fields: { 'standards-channels': ['react'] }, packages: ['packages/missing'] });
	await context.write('package.json', 'malformed manifest that must not be needed');
	return context;
};
test('honors explicit framework channels without reading irrelevant manifests', async () => {
	const { params } = await setupOverride();

	const result = await resolvePlanningStandards(params);

	expect(result.content).toContain('Preserve React state.');
	expect(result.observations.some((observation) => observation.path.endsWith('package.json'))).toBe(false);
});
const setupInvalidManifest = async () => {
	const context = await setup();
	await context.write('package.json', '{invalid');
	return context;
};
test('reports malformed framework input instead of supplying base-only guidance', async () => {
	const { params } = await setupInvalidManifest();

	await expect(resolvePlanningStandards(params)).rejects.toThrow(/Invalid standards dependency manifest/);
});
const setupNonNode = async () => {
	const context = await setup();
	await rm(join(context.cwd, 'package.json'));
	return context;
};
test('retains base standards for a non-Node repository with no root manifest', async () => {
	const { params } = await setupNonNode();

	const result = await resolvePlanningStandards(params);

	expect(result.content).toContain('Keep public contracts stable.');
	expect(result.dependencies).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'package.json', kind: 'absence' })]));
});
const setupSetAppearance = async () => {
	const context = await setup();
	const prior = await resolvePlanningStandards(context.params);
	await context.write('house/tests/behavior/document.md', '# Behavior\nTest observable outcomes.');
	return { ...context, prior };
};
test('invalidates an absent standards set that becomes a directory', async () => {
	const { params, prior } = await setupSetAppearance();

	const result = await resolvePlanningStandards(params);

	expect(result.policyDigest).not.toBe(prior.policyDigest);
	expect(result.content).toContain('Test observable outcomes.');
	expect(result.dependencies).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'membership', root: 'house/tests' })]));
});
const setupLinkedStandard = async () => {
	const context = await setup();
	await rm(join(context.cwd, 'house/code/base/document.md'));
	await symlink(join(context.cwd, 'package.json'), join(context.cwd, 'house/code/base/document.md'));
	return context;
};
test('refuses redirected standards text rather than treating it as absent', async () => {
	const { params } = await setupLinkedStandard();

	await expect(resolvePlanningStandards(params)).rejects.toThrow(/unobservable entries/);
});
const setupChangedRule = async () => {
	const context = await setup();
	await context.write('house/code/base/01-contract/rule.md', '---\nsummary: Preserve contracts\n---\nKeep original arguments.');
	const previous = await resolvePlanningStandards(context.params);
	await context.write('house/code/base/01-contract/rule.md', '---\nsummary: Preserve contracts\n---\nKeep arguments and return values.');
	return { ...context, previous };
};
test('binds changed rule bytes to a new policy and the exact rendered guidance', async () => {
	const { params, previous } = await setupChangedRule();

	const current = await resolvePlanningStandards(params);

	expect(current.policyDigest).not.toBe(previous.policyDigest);
	expect(current.content).toContain('Keep arguments and return values.');
	expect(current.content).not.toContain('Keep original arguments.');
});

test('includes root frameworks alongside explicitly selected child packages', async () => {
	const { params } = await setupFrameworkUnion();

	const result = await resolvePlanningStandards({
		...params,
		scope: { kind: PlanningVocabulary.Scope.Selected, claimIds: [], phaseIds: [], packageRoots: ['src', 'packages/server'] },
	});

	expect(result.content).toContain('Preserve React state.');
	expect(result.content).toContain('Preserve dependency injection.');
});

const setupFifoManifest = async () => {
	const context = await setup();
	await rm(join(context.cwd, 'package.json'));
	execFileSync('mkfifo', [join(context.cwd, 'package.json')]);
	return context;
};
test('rejects a named-pipe framework manifest without waiting for a writer', async () => {
	const { params } = await setupFifoManifest();

	await expect(resolvePlanningStandards(params)).rejects.toThrow(/not a regular file/);
});

const setupFifoMarker = async () => {
	const context = await setup();
	const path = 'house/common/frameworks/getFrameworkFacts.ts';
	await context.write(path, 'temporary');
	await rm(join(context.cwd, path));
	execFileSync('mkfifo', [join(context.cwd, path)]);
	return context;
};
test('refuses special-file standards markers rather than declaring them readable modules', async () => {
	const { params } = await setupFifoMarker();

	await expect(resolvePlanningStandards(params)).rejects.toThrow(/not a regular file or directory/);
});
const setupInvalidDependencyShape = async () => {
	const context = await setup();
	await context.write('package.json', '{"dependencies":{"react":12}}');
	return context;
};
test('refuses malformed dependency declarations in otherwise valid manifest JSON', async () => {
	const { params } = await setupInvalidDependencyShape();

	await expect(resolvePlanningStandards(params)).rejects.toThrow(/Invalid standards dependency manifest/);
});

test('refuses workspace discovery outside the declared repository and pack roots', async () => {
	const { params } = await setup({ fields: { 'packages-dir': '../unrelated-workspace' } });

	await expect(resolvePlanningStandards(params)).rejects.toThrow(/outside declared roots/);
});

const setupChangingInputs = async ({ repeated }: { repeated: boolean }) => {
	const context = await setupFrameworkUnion();
	const actual = jest.requireActual<typeof import('node:fs/promises')>('node:fs/promises');
	const open = actual.open;
	const root = await realpath(context.cwd);
	const trigger = join(root, repeated ? 'package.json' : 'house/lightsout-standards.json');
	const changedPath = join(context.cwd, repeated ? 'packages/server/package.json' : 'package.json');
	let changed = false;
	jest.spyOn(actual, 'open').mockImplementation(async (...args) => {
		if (String(args[0]) === trigger && !changed) {
			changed = true;
			await writeFile(changedPath, '{"dependencies":{}}');
		}
		return open(...args);
	});
	return context;
};
test.each([false, true])('refuses changed acquisition inputs with repeated read=$0', async (repeated) => {
	const { params } = await setupChangingInputs({ repeated });

	await expect(resolvePlanningStandards(params)).rejects.toThrow(/changed during resolution/);
});

const setupReadOrder = async () => {
	const context = await setupFrameworkUnion();
	await context.write('packages/alpha/package.json', '{"dependencies":{}}');
	await context.write('packages/omega/package.json', '{"dependencies":{}}');
	const actual = jest.requireActual<typeof import('node:fs/promises')>('node:fs/promises');
	const open = actual.open;
	let slow = 'alpha';
	jest.spyOn(actual, 'open').mockImplementation(async (...args) => {
		if (String(args[0]).endsWith(join('packages', slow, 'package.json'))) await new Promise((resolve) => setTimeout(resolve, 50));
		return open(...args);
	});
	const first = await resolvePlanningStandards(context.params);
	slow = 'omega';
	return { ...context, first };
};
test('lists standards dependencies in one order whichever manifest read finishes first', async () => {
	const { params, first } = await setupReadOrder();

	const second = await resolvePlanningStandards(params);

	expect(second.dependencies).toStrictEqual(first.dependencies);
});

const setupRelocated = async ({ changed = false }: { changed?: boolean } = {}) => {
	const first = await setupFrameworkUnion();
	const second = await setupFrameworkUnion();
	const previous = await resolvePlanningStandards(first.params);
	if (changed) await second.write('house/code/base/document.md', '# Base\nPreserve newly required ordering too.');
	return { ...second, previous };
};
test('preserves exact standards policy and channel identities across identical fresh checkouts', async () => {
	const { params, previous } = await setupRelocated();

	const current = await resolvePlanningStandards(params);

	expect(current).toEqual(previous);
	expect(current.observations.every((observation) => observation.path.startsWith('workspace/'))).toBe(true);
});

test('still rejects changed standards bytes after relocation', async () => {
	const { params, previous } = await setupRelocated({ changed: true });

	const current = await resolvePlanningStandards(params);

	expect(current.policyDigest).not.toBe(previous.policyDigest);
	expect(current.channels).not.toEqual(previous.channels);
});
