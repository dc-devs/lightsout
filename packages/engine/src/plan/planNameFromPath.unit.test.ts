import { join, resolve } from 'node:path';
import { expect, test } from '@jest/globals';
import { planNameFromPath } from '#src/plan/planNameFromPath.ts';

/** A repo root the cases resolve against — nothing is read from disk, so it need not exist. */
const cwd = resolve('/repo');

test('planNameFromPath: a plan folder under the plans directory answers its own name', () => {
	expect(planNameFromPath({ cwd, planPath: join('.lightsout', 'plans', 'lo-52-status-progress') })).toBe('lo-52-status-progress');
});

test('planNameFromPath: a plan.md inside a plan folder answers the folder, not the file', () => {
	expect(planNameFromPath({ cwd, planPath: join('.lightsout', 'plans', 'lo-52-status-progress', 'plan.md') })).toBe('lo-52-status-progress');
});

test('planNameFromPath: an absolute path into the plans directory reads the same as the relative one', () => {
	expect(planNameFromPath({ cwd, planPath: join(cwd, '.lightsout', 'plans', 'rate-limit-banner', 'overview.md') })).toBe('rate-limit-banner');
});

test('planNameFromPath: a path outside the plans directory is not a plan workspace', () => {
	// a --plan pointing at an arbitrary markdown file has no folder-name
	// convention to keep, so warning about its parent would be noise
	expect(planNameFromPath({ cwd, planPath: 'ghost.md' })).toBe(undefined);
	expect(planNameFromPath({ cwd, planPath: join('plans', 'demo', 'plan.md') })).toBe(undefined);
});

test('planNameFromPath: the plans directory itself names no plan', () => {
	expect(planNameFromPath({ cwd, planPath: join('.lightsout', 'plans') })).toBe(undefined);
});

test('planNameFromPath: a path above the plans directory answers undefined rather than a walk-up segment', () => {
	expect(planNameFromPath({ cwd, planPath: join('.lightsout', 'runs', 'latest') })).toBe(undefined);
	expect(planNameFromPath({ cwd, planPath: resolve('/elsewhere/plans/demo') })).toBe(undefined);
});

test('planNameFromPath: a file inside a plan subfolder of a ticket folder answers the plan address', () => {
	// the address is spelled with `/` whatever the platform's path separator is,
	// because it is the `--name` value every plan subcommand takes
	expect(planNameFromPath({ cwd, planPath: join('.lightsout', 'plans', 'lo-7-search', '001-search-basics', 'plan.md') })).toBe('lo-7-search/001-search-basics');
});

test('planNameFromPath: a file deeper inside a plan subfolder still answers that plan address', () => {
	// only the first two segments under the plans directory decide the address,
	// so a path that walks further into the plan's own files reads the same
	expect(planNameFromPath({ cwd, planPath: join('.lightsout', 'plans', 'lo-7-search', '001-search-basics', 'decisions', 'log.md') })).toBe(
		'lo-7-search/001-search-basics',
	);
});

test('planNameFromPath: a plan subfolder given without a file answers its plan address', () => {
	expect(planNameFromPath({ cwd, planPath: join('.lightsout', 'plans', 'lo-7-search', '002-ranking') })).toBe('lo-7-search/002-ranking');
});

test('planNameFromPath: a subfolder whose name is not a plan id leaves the legacy folder name', () => {
	expect(planNameFromPath({ cwd, planPath: join('.lightsout', 'plans', 'lo-7-search', 'implemented', 'phase1-search.md') })).toBe('lo-7-search');
});
