import { expect, test } from '@jest/globals';
import type { ScanFinding } from '@/contracts';
import { matchRemainingFindings } from '@/refactor';

const finding = ({ detector, cluster, paths }: { detector: ScanFinding['detector']; cluster: string; paths: string[] }): ScanFinding => ({
	detector,
	severity: 'finding',
	cluster,
	files: paths.map((path) => ({ path })),
	detail: 'stub',
});

test('stable clusters match by id; a vanished id is resolved', () => {
	const frozen = [finding({ detector: 'structure', cluster: 'multi-export:src/a.ts', paths: ['src/a.ts'] })];

	expect(matchRemainingFindings({ frozen, live: frozen })).toStrictEqual(['multi-export:src/a.ts']);
	expect(matchRemainingFindings({ frozen, live: [] })).toStrictEqual([]);
});

test('a clone whose lines shifted (new cluster id, same file pair) is STILL remaining', () => {
	const frozen = [finding({ detector: 'clone', cluster: 'clone:src/b.ts:40', paths: ['src/b.ts', 'src/a.ts'] })];
	const live = [finding({ detector: 'clone', cluster: 'clone:src/b.ts:55', paths: ['src/a.ts', 'src/b.ts'] })];

	// line drift must not read as resolved — that is a gate escape
	expect(matchRemainingFindings({ frozen, live })).toStrictEqual(['clone:src/b.ts:40']);
});

test('a clone is resolved only when no live clone shares its file pair', () => {
	const frozen = [finding({ detector: 'clone', cluster: 'clone:src/b.ts:40', paths: ['src/b.ts', 'src/a.ts'] })];
	const live = [finding({ detector: 'clone', cluster: 'clone:src/c.ts:10', paths: ['src/c.ts', 'src/d.ts'] })];

	expect(matchRemainingFindings({ frozen, live })).toStrictEqual([]);
});
