import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ScanFinding } from '@lightsout/contracts';
import { matchRemainingFindings } from '../src/refactor';

const finding = ({ detector, cluster, paths }: { detector: ScanFinding['detector']; cluster: string; paths: string[] }): ScanFinding => ({
	detector,
	severity: 'finding',
	cluster,
	files: paths.map((path) => ({ path })),
	detail: 'stub',
});

test('stable clusters match by id; a vanished id is resolved', () => {
	const frozen = [finding({ detector: 'structure', cluster: 'multi-export:src/a.ts', paths: ['src/a.ts'] })];

	assert.deepEqual(matchRemainingFindings({ frozen, live: frozen }), ['multi-export:src/a.ts']);
	assert.deepEqual(matchRemainingFindings({ frozen, live: [] }), []);
});

test('a clone whose lines shifted (new cluster id, same file pair) is STILL remaining', () => {
	const frozen = [finding({ detector: 'clone', cluster: 'clone:src/b.ts:40', paths: ['src/b.ts', 'src/a.ts'] })];
	const live = [finding({ detector: 'clone', cluster: 'clone:src/b.ts:55', paths: ['src/a.ts', 'src/b.ts'] })];

	assert.deepEqual(matchRemainingFindings({ frozen, live }), ['clone:src/b.ts:40'], 'line drift must not read as resolved — that is a gate escape');
});

test('a clone is resolved only when no live clone shares its file pair', () => {
	const frozen = [finding({ detector: 'clone', cluster: 'clone:src/b.ts:40', paths: ['src/b.ts', 'src/a.ts'] })];
	const live = [finding({ detector: 'clone', cluster: 'clone:src/c.ts:10', paths: ['src/c.ts', 'src/d.ts'] })];

	assert.deepEqual(matchRemainingFindings({ frozen, live }), []);
});
