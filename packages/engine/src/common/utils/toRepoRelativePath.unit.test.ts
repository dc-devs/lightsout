import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { toRepoRelativePath } from '#src/common/utils/toRepoRelativePath.ts';

const cwd = join('/', 'repos', 'consumer');

test('toRepoRelativePath: a relative path is kept exactly as the caller named it', () => {
	expect(toRepoRelativePath({ cwd, path: join('plans', 'demo', 'plan.md') })).toBe(join('plans', 'demo', 'plan.md'));
});

test('toRepoRelativePath: an absolute path inside the repo is rewritten relative to it', () => {
	expect(toRepoRelativePath({ cwd, path: join(cwd, 'plans', 'demo', 'plan.md') })).toBe(join('plans', 'demo', 'plan.md'));
});

test('toRepoRelativePath: the same file named either way comes out the same — the form a guard can compare', () => {
	// pinned to the literal on both sides rather than to each other: two calls
	// that agree are still both wrong if the function returns a constant
	expect(toRepoRelativePath({ cwd, path: join(cwd, 'plan.md') })).toBe('plan.md');
	expect(toRepoRelativePath({ cwd, path: 'plan.md' })).toBe('plan.md');
});

test('toRepoRelativePath: a path outside the repo stays reachable as a route up and back down', () => {
	expect(toRepoRelativePath({ cwd, path: join('/', 'repos', 'elsewhere', 'plan.md') })).toBe(join('..', 'elsewhere', 'plan.md'));
});

test('toRepoRelativePath: a relative path that wanders is normalized, not re-rooted', () => {
	expect(toRepoRelativePath({ cwd, path: join('plans', '..', 'plan.md') })).toBe('plan.md');
});

test('toRepoRelativePath: the empty path is its own relative form — a run with no plan records none', () => {
	expect(toRepoRelativePath({ cwd, path: '' })).toBe('');
});
