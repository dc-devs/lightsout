import { describe, expect, test } from '@jest/globals';
import { detectExportCollisions, type ExportCensus } from '#src/plan/evidence/index.ts';

/**
 * A census bucketed the way `buildExportCensus` buckets it: the key is the
 * tier-0 name key, spelled as a literal here rather than computed, so the test
 * states the comparator's answer independently of the code under test.
 */
const setupCensus = ({
	buckets = [],
	symbols = [],
}: {
	buckets?: Array<{ key: string; entries: Array<{ name: string; path: string }> }>;
	symbols?: string[];
} = {}) => {
	const census: ExportCensus = new Map(buckets.map(({ key, entries }) => [key, entries]));

	return { census, symbols };
};

describe('detectExportCollisions', () => {
	test('detectExportCollisions: a synonym twin is reported with the export it collides with, and a novel symbol is not', () => {
		const { census, symbols } = setupCensus({
			buckets: [
				{
					key: 'data get user',
					entries: [{ name: 'getUserData', path: 'packages/engine/src/users/getUserData.ts' }],
				},
			],
			symbols: ['fetchUserData', 'formatDate'],
		});

		const collisions = detectExportCollisions({ census, symbols });

		expect(collisions).toEqual([
			{
				symbol: 'fetchUserData',
				collidesWith: [{ name: 'getUserData', path: 'packages/engine/src/users/getUserData.ts' }],
			},
		]);
	});

	test('detectExportCollisions: a casing-only pair is a framework pair, not a collision', () => {
		const { census, symbols } = setupCensus({
			buckets: [
				{
					key: 'get started',
					entries: [{ name: 'get-started', path: 'apps/web/src/routes/get-started.tsx' }],
				},
			],
			symbols: ['GetStarted'],
		});

		const collisions = detectExportCollisions({ census, symbols });

		expect(collisions).toEqual([]);
	});

	test('detectExportCollisions: the name index is never a planned symbol', () => {
		const { census, symbols } = setupCensus({
			buckets: [
				{
					key: 'index',
					entries: [{ name: 'index', path: 'packages/engine/src/plan/index.ts' }],
				},
				{
					key: 'build census export',
					entries: [{ name: 'buildExportCensus', path: 'packages/engine/src/plan/evidence/buildExportCensus.ts' }],
				},
			],
			symbols: ['index', 'buildExportCensus'],
		});

		const collisions = detectExportCollisions({ census, symbols });

		expect(collisions).toEqual([
			{
				symbol: 'buildExportCensus',
				collidesWith: [{ name: 'buildExportCensus', path: 'packages/engine/src/plan/evidence/buildExportCensus.ts' }],
			},
		]);
	});

	test('detectExportCollisions: a bucket holding both a casing pair and a synonym twin reports only the twin', () => {
		const { census, symbols } = setupCensus({
			buckets: [
				{
					key: 'create report',
					entries: [
						{ name: 'create-report', path: 'apps/web/src/routes/create-report.tsx' },
						{ name: 'makeReport', path: 'packages/engine/src/reports/makeReport.ts' },
					],
				},
			],
			symbols: ['createReport'],
		});

		const collisions = detectExportCollisions({ census, symbols });

		expect(collisions).toEqual([
			{
				symbol: 'createReport',
				collidesWith: [{ name: 'makeReport', path: 'packages/engine/src/reports/makeReport.ts' }],
			},
		]);
	});
});
