import { expect, test } from '@jest/globals';
import { PlanningDependency } from '#src/contracts/index.ts';

const setup = () => {
	const hash = 'b'.repeat(64);
	const dependencies = [
		{ id: 'd1', kind: 'content', path: 'src/upload.ts', sha256: hash },
		{ id: 'd2', kind: 'absence', path: 'src/other.ts' },
		{
			id: 'd3',
			kind: 'search',
			roots: ['src'],
			query: 'upload',
			options: { regex: false, caseSensitive: true, glob: '**/*.ts', exclude: [] },
			universeFingerprint: hash,
			resultFingerprint: hash,
		},
		{ id: 'd4', kind: 'collection', collection: 'claims', scope: 'whole-plan', memberDigests: { c1: hash } },
		{ id: 'd5', kind: 'unknown', roots: ['src'], reason: 'Unobserved shell read', fallbackFingerprint: hash },
		{ id: 'd6', kind: 'membership', root: 'src', policy: { exclude: [] }, fingerprint: hash },
	];
	return { hash, dependencies };
};

const setupDependency = ({ variant }: { variant: number }) => {
	const { hash, dependencies } = setup();
	const invalid = [
		{ id: 'd', kind: 'content', path: '../secret', sha256: hash },
		{ id: 'd', kind: 'absence', path: '/outside' },
		{ id: 'd', kind: 'content', path: 'src/a.ts', sha256: 'bad' },
		{ ...dependencies[2], roots: [] },
		{ ...dependencies[4], roots: [] },
		{ ...dependencies[1], sha256: hash },
	];
	const cases = [...dependencies, ...invalid];
	return {
		input: cases[variant],
		expected: variant < dependencies.length ? { success: true, data: cases[variant] } : expect.objectContaining({ success: false }),
	};
};

test.each([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])('distinguishes absent unknown and searched dependencies', (variant) => {
	const { input, expected } = setupDependency({ variant });

	const result = PlanningDependency.safeParse(input);

	expect(result).toStrictEqual(expected);
});

const setupObservedPolicy = ({ direct }: { direct: boolean }) => {
	const { hash, dependencies } = setup();
	return direct
		? { ...dependencies[5], policy: { exclude: ['.lightsout/**'], recursive: false } }
		: { ...dependencies[4], policy: { exclude: ['.lightsout/**'], identity: hash } };
};
test.each([false, true])('preserves explicit observed namespace policy without defaulting old records', (direct) => {
	const input = setupObservedPolicy({ direct });

	const result = PlanningDependency.parse(input);

	expect(result).toStrictEqual(input);
});
