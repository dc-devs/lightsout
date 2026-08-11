import { describe, expect, test } from '@jest/globals';
import { PlanFacts } from '@/contracts';

const setupFacts = (overrides: Record<string, unknown> = {}) => {
	const area = {
		area: 'engine plan pipeline',
		affectedPackages: ['src/plan'],
		filesToModify: [{ path: 'src/plan/runPlanVerifyFacts.ts', role: 'stamps the verification onto facts.json' }],
		patternsToMirror: [{ path: 'src/plan/runPlanDraft.ts', takeaway: 'the run<X> entry-point shape' }],
		integrationPoints: [{ name: 'verifyFacts', signature: '({ cwd, facts }) => Promise<PathVerification>', at: 'src/plan/verifyFacts.ts:31' }],
		scripts: [{ key: 'check', command: 'tsc --noEmit' }],
		namingConvention: 'run<X> functions, one export per file',
	};
	const facts = {
		request: 'add a verify-facts subcommand',
		areas: [area],
		verification: { pathsChecked: 2, missingPaths: [], scriptsChecked: 1, missingScripts: [], createPathsThatExist: [] },
		verifiedAt: '2026-08-04T00:00:00.000Z',
		...overrides,
	};

	return { facts };
};

describe('PlanFacts', () => {
	test('a persisted facts.json parses with request, areas, verification and stamp intact', () => {
		const { facts } = setupFacts();

		const parsed = PlanFacts.parse(facts);

		expect(parsed).toStrictEqual({
			request: 'add a verify-facts subcommand',
			areas: [
				{
					area: 'engine plan pipeline',
					affectedPackages: ['src/plan'],
					filesToModify: [{ path: 'src/plan/runPlanVerifyFacts.ts', role: 'stamps the verification onto facts.json' }],
					patternsToMirror: [{ path: 'src/plan/runPlanDraft.ts', takeaway: 'the run<X> entry-point shape' }],
					integrationPoints: [{ name: 'verifyFacts', signature: '({ cwd, facts }) => Promise<PathVerification>', at: 'src/plan/verifyFacts.ts:31' }],
					scripts: [{ key: 'check', command: 'tsc --noEmit' }],
					namingConvention: 'run<X> functions, one export per file',
				},
			],
			verification: { pathsChecked: 2, missingPaths: [], scriptsChecked: 1, missingScripts: [], createPathsThatExist: [] },
			verifiedAt: '2026-08-04T00:00:00.000Z',
		});
	});

	test('areas defaults to empty when omitted', () => {
		const { facts } = setupFacts({ areas: undefined });

		const parsed = PlanFacts.parse(facts);

		// readPlanFacts consumers flat-map areas without guarding for absence
		expect(parsed.areas).toStrictEqual([]);
	});

	test('nested defaults are applied to a sparse area and a sparse verification', () => {
		const { facts } = setupFacts({
			areas: [{ area: 'cli surface', namingConvention: '<verb>Command.ts per subcommand' }],
			verification: { pathsChecked: 0, scriptsChecked: 0 },
		});

		const parsed = PlanFacts.parse(facts);

		expect(parsed).toStrictEqual({
			request: 'add a verify-facts subcommand',
			areas: [
				{
					area: 'cli surface',
					affectedPackages: [],
					filesToModify: [],
					patternsToMirror: [],
					integrationPoints: [],
					scripts: [],
					namingConvention: '<verb>Command.ts per subcommand',
				},
			],
			verification: { pathsChecked: 0, missingPaths: [], scriptsChecked: 0, missingScripts: [], createPathsThatExist: [] },
			verifiedAt: '2026-08-04T00:00:00.000Z',
		});
	});

	for (const field of ['request', 'verification', 'verifiedAt']) {
		test(`rejects a facts.json missing ${field}`, () => {
			const { facts } = setupFacts({ [field]: undefined });

			const result = PlanFacts.safeParse(facts);

			// ${field} is required — a facts.json the engine has not stamped is authored
			// facts, not plan facts
			expect(result.success).toBe(false);
		});
	}

	test('rejects an unstamped authored facts file', () => {
		const { facts } = setupFacts({ verification: undefined, verifiedAt: undefined });

		const result = PlanFacts.safeParse(facts);

		// reading a plan whose facts were never verified is a hard error, never a
		// silent empty verification
		expect(result.success).toBe(false);
	});

	test('rejects a non-string verifiedAt rather than coercing a timestamp', () => {
		const { facts } = setupFacts({ verifiedAt: 1780531200000 });

		const result = PlanFacts.safeParse(facts);

		// the field is the ISO string the verify step writes, so facts.json
		// round-trips unchanged
		expect(result.success).toBe(false);
	});

	test('one malformed area rejects the whole facts file', () => {
		const { facts } = setupFacts({ areas: [{ area: 'an area with no namingConvention' }] });

		const result = PlanFacts.safeParse(facts);

		// a partly readable facts.json is refused at the read boundary rather than
		// driving a half-blank plan
		expect(result.success).toBe(false);
	});

	test('a malformed verification rejects the whole facts file', () => {
		const { facts } = setupFacts({ verification: { pathsChecked: 2, missingPaths: [], missingScripts: [] } });

		const result = PlanFacts.safeParse(facts);

		// scriptsChecked is what distinguishes "no scripts missing" from "no scripts
		// checked"
		expect(result.success).toBe(false);
	});

	test('unknown keys are stripped', () => {
		const { facts } = setupFacts();

		const parsed = PlanFacts.parse({ ...facts, planName: 'packages-to-src', notes: 'hand-added' });

		// facts.json is keyed by its workspace directory, so a hand-added planName
		// never becomes contract data
		expect(Object.keys(parsed).sort()).toStrictEqual(['areas', 'request', 'verification', 'verifiedAt']);
	});
});
