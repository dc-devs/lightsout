import { readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type ts from 'typescript';
import { isTestFile } from '@/common/utils/isTestFile';
import { listSourceFiles } from '@/common/utils/listSourceFiles';
import { messageOf } from '@/common/utils/messageOf';
import type { StandardsInputKind, StandardsCheckRun } from '@/contracts';
import { buildCheckInput } from '@/standardsCheck/common/checkInputs/buildCheckInput';
import { typescriptInputKinds } from '@/standardsCheck/common/constants/typescriptInputKinds';
import { runRuleCheck } from '@/standardsCheck/common/utils/runRuleCheck';
import type { LoadedStandardsPackage, LoadedStandardsRule } from '@/standardsPackages';

interface Params {
	pkg: LoadedStandardsPackage;
}

/**
 * The two fixture folders every rule ships, and the two verdicts they carry: a
 * closed pair rather than a loose string, so the folder name and the
 * expectation read from it can never drift apart.
 */
const fixtureSides = ['fail', 'pass'] as const;

type FixtureSide = (typeof fixtureSides)[number];

/**
 * The engine's own TypeScript, for parsing fixtures. Resolved through `require`
 * rather than a literal `import('typescript')`, which a bundler would answer by
 * pulling the whole ~8MB compiler into the shipped program — the cost the
 * engine borrows the consumer's compiler to avoid. An install that has none
 * (the plugin without a TypeScript beside it) simply cannot validate those
 * rules, which is a note, not a fault in the package.
 */
const getEngineTypescript = () => {
	let compiler: typeof ts | undefined;

	try {
		// Anchored on the running program, so this is the engine's own dependency.
		// require() is typed `any`; there is nothing to narrow against.
		compiler = createRequire(process.argv[1])('typescript') as typeof ts;
	} catch {
		compiler = undefined;
	}

	return compiler;
};

/**
 * The fixture sides a rule fails to ship. Loading accepts a package without
 * them — a shipped package carries no evidence, the way a bundle carries no
 * tests — so this is where the pair is demanded, of the person authoring it.
 */
const missingFixtureSides = async ({ fixturesPath }: { fixturesPath: string }) => {
	const missing: FixtureSide[] = [];

	for (const side of fixtureSides) {
		const entries = await readdir(join(fixturesPath, side)).catch(() => undefined);

		if (entries === undefined || entries.length === 0) {
			missing.push(side);
		}
	}

	return missing;
};

/** One rule's check, run against one side of its fixture pair as if that folder were a whole repo. */
const checkFixture = async ({
	rule,
	inputKind,
	run,
	side,
	compiler,
}: {
	rule: LoadedStandardsRule;
	inputKind: StandardsInputKind;
	run: StandardsCheckRun;
	/** The fixture folder to run the check against — also the folder's own name. */
	side: FixtureSide;
	compiler?: typeof ts;
}) => {
	const cwd = join(rule.fixturesPath, side);
	const files = await listSourceFiles({ cwd });
	const input = await buildCheckInput({
		kind: inputKind,
		cwd,
		source: files.filter((file) => !isTestFile(file)),
		tests: files.filter((file) => isTestFile(file)),
		files,
		referenceFiles: files,
		packagesDir: 'packages',
		settings: rule.defaultSettings,
		cache: new Map<string, string>(),
		compiler,
	});

	return runRuleCheck({ rule: rule.id, run, input, settings: rule.defaultSettings });
};

/**
 * Run every check in a package against its own fixtures.
 *
 * This is the question load time deliberately does not ask. Loading a package
 * validates its structure and its honesty — that a rule claiming a check ships
 * one — because those are what break at run time. Whether the check catches
 * what the rule's prose describes is authoring work, answered on demand by
 * `lightsout standards-validate` and paid for by nobody else.
 *
 * A rule that cannot be validated here is a note rather than a problem:
 * judgment-only rules keep their fixtures for measuring the review agent's
 * accuracy, and a syntax-tree rule cannot be exercised where no TypeScript
 * exists to parse with. Channels are ignored — authoring covers every channel,
 * whatever the machine doing the authoring happens to run.
 */
export const validateStandardsPackage = async ({ pkg }: Params): Promise<{ problems: string[]; notes: string[] }> => {
	// Resolving TypeScript means loading a multi-megabyte module; a package whose
	// rules never ask for a parsed tree should not pay for it.
	const hasParsingRule = pkg.rules.some((rule) => rule.inputKind !== undefined && typescriptInputKinds.has(rule.inputKind));
	const compiler = hasParsingRule ? getEngineTypescript() : undefined;
	const problems: string[] = [];
	const notes: string[] = [];

	for (const rule of pkg.rules) {
		const { run, inputKind } = rule;
		const missing = await missingFixtureSides({ fixturesPath: rule.fixturesPath });

		if (missing.length > 0) {
			// Asked of every rule, judgment-only included: their pair is what the
			// review agent's accuracy is measured against.
			problems.push(...missing.map((side) => `${rule.id}: fixtures/${side}/ is missing or empty — every rule ships a fixture pair`));
			continue;
		}

		if (run === undefined || inputKind === undefined) {
			notes.push(`${rule.id}: judgment-only — fixtures reserved for agent accuracy`);
			continue;
		}

		if (compiler === undefined && typescriptInputKinds.has(inputKind)) {
			notes.push(`${rule.id}: not validated — its ${inputKind} input needs a typescript this install does not have`);
			continue;
		}

		for (const side of fixtureSides) {
			try {
				const found = await checkFixture({ rule, inputKind, run, side, compiler });

				if (side === 'fail' && found.length === 0) {
					problems.push(`${rule.id}: the fail fixture produced no finding — the check does not catch what the rule describes`);
				}

				if (side === 'pass' && found.length > 0) {
					problems.push(`${rule.id}: the pass fixture produced ${found.length} finding(s) — the check flags code the rule allows`);
				}
			} catch (error) {
				problems.push(`${rule.id}: the ${side} fixture could not be checked — ${messageOf({ error })}`);
			}
		}
	}

	return { problems, notes };
};
