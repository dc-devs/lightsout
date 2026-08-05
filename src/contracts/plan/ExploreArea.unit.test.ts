import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ExploreArea } from '@/contracts';

const setupArea = (overrides: Record<string, unknown> = {}) => {
	const area = {
		area: 'engine plan pipeline',
		affectedPackages: ['src/plan'],
		filesToModify: [{ path: 'src/plan/runPlanVerifyFacts.ts', role: 'stamps the verification onto facts.json' }],
		patternsToMirror: [{ path: 'src/plan/runPlanDraft.ts', takeaway: 'the run<X> entry-point shape' }],
		integrationPoints: [{ name: 'verifyFacts', signature: '({ cwd, facts }) => Promise<PathVerification>', at: 'src/plan/verifyFacts.ts:31' }],
		scripts: [{ key: 'check', command: 'tsc --noEmit' }],
		namingConvention: 'run<X> functions, one export per file',
		...overrides,
	};

	return { area };
};

describe('ExploreArea', () => {
	test('a full explorer area parses with every field preserved', () => {
		const { area } = setupArea();

		const parsed = ExploreArea.parse(area);

		assert.deepEqual(parsed, {
			area: 'engine plan pipeline',
			affectedPackages: ['src/plan'],
			filesToModify: [{ path: 'src/plan/runPlanVerifyFacts.ts', role: 'stamps the verification onto facts.json' }],
			patternsToMirror: [{ path: 'src/plan/runPlanDraft.ts', takeaway: 'the run<X> entry-point shape' }],
			integrationPoints: [{ name: 'verifyFacts', signature: '({ cwd, facts }) => Promise<PathVerification>', at: 'src/plan/verifyFacts.ts:31' }],
			scripts: [{ key: 'check', command: 'tsc --noEmit' }],
			namingConvention: 'run<X> functions, one export per file',
		});
	});

	test('every array field defaults to empty so a sparse explorer report still parses', () => {
		const parsed = ExploreArea.parse({ area: 'cli surface', namingConvention: '<verb>Command.ts per subcommand' });

		assert.deepEqual(
			parsed,
			{
				area: 'cli surface',
				affectedPackages: [],
				filesToModify: [],
				patternsToMirror: [],
				integrationPoints: [],
				scripts: [],
				namingConvention: '<verb>Command.ts per subcommand',
			},
			'verifyFacts flat-maps filesToModify/patternsToMirror and reads scripts.length off every area without guarding for absence',
		);
	});

	test('unknown keys an explorer volunteers are stripped', () => {
		const { area } = setupArea();

		const parsed = ExploreArea.parse({ ...area, fileContents: 'the whole file pasted in', confidence: 0.9 });

		assert.deepEqual(Object.keys(parsed).sort(), ['affectedPackages', 'area', 'filesToModify', 'integrationPoints', 'namingConvention', 'patternsToMirror', 'scripts'], 'the area carries data, not file contents — extra keys never reach facts.json');
	});

	for (const field of ['area', 'namingConvention']) {
		test(`rejects an area missing ${field}`, () => {
			const { area } = setupArea({ [field]: undefined });

			const result = ExploreArea.safeParse(area);

			assert.equal(result.success, false, `${field} is required — it is the one line that tells the implementing agent what this bundle covers`);
		});
	}

	for (const { label, entry } of [
		{ label: 'a filesToModify entry with no role', entry: { filesToModify: [{ path: 'src/plan/runPlanDraft.ts' }] } },
		{ label: 'a patternsToMirror entry with no takeaway', entry: { patternsToMirror: [{ path: 'src/plan/runPlanDraft.ts' }] } },
		{ label: 'an integrationPoints entry with no at', entry: { integrationPoints: [{ name: 'verifyFacts', signature: '({ cwd, facts }) => Promise<PathVerification>' }] } },
		{ label: 'a scripts entry with no command', entry: { scripts: [{ key: 'check' }] } },
	]) {
		test(`rejects ${label}`, () => {
			const { area } = setupArea(entry);

			const result = ExploreArea.safeParse(area);

			assert.equal(result.success, false, 'a half-filled entry is refused at the contract boundary rather than reaching the on-disk verification as an undefined path');
		});
	}

	test('rejects a non-string path on a filesToModify entry rather than coercing it', () => {
		const { area } = setupArea({ filesToModify: [{ path: 42, role: 'a path that is not a path' }] });

		const result = ExploreArea.safeParse(area);

		assert.equal(result.success, false, 'verifyFacts joins the path onto cwd — it must be a string before it is stat-ed');
	});

	test('rejects an affectedPackages value that is not an array of strings', () => {
		const { area } = setupArea({ affectedPackages: 'src/plan' });

		const result = ExploreArea.safeParse(area);

		assert.equal(result.success, false, 'a bare string in place of the list is a malformed area — the packages scope the script lookup');
	});
});
