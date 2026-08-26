import { readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type ts from 'typescript';
import { messageOf } from '#src/common/utils/messageOf.ts';
import type { RawStandardsFinding } from '#src/contracts/index.ts';
import { typescriptInputKinds } from '#src/standardsCheck/common/constants/typescriptInputKinds.ts';
import { checkFixtureTree } from '#src/standardsCheck/common/utils/checkFixtureTree.ts';
import type { LoadedStandardsPack } from '#src/standardsPacks/index.ts';

interface Params {
	pack: LoadedStandardsPack;
}

/**
 * The two fixture folders every rule ships, and the two verdicts they carry: a
 * closed pair rather than a loose string, so the folder name and the
 * expectation read from it can never drift apart.
 */
const FixtureSide = {
	Fail: 'fail',
	Pass: 'pass',
} as const;

type FixtureSide = (typeof FixtureSide)[keyof typeof FixtureSide];

/**
 * The engine's own TypeScript, for parsing fixtures. Resolved through `require`
 * rather than a literal `import('typescript')`, which a bundler would answer by
 * pulling the whole ~8MB compiler into the shipped program — the cost the
 * engine borrows the consumer's compiler to avoid. An install that has none
 * (the plugin without a TypeScript beside it) simply cannot validate those
 * rules, which is a note, not a fault in the pack.
 */
const getEngineTypescript = () => {
	let compiler: typeof ts | undefined;

	try {
		// Anchored on the running program, so this is the engine's own dependency.
		// require() is typed `any`; the declaration above is what states the shape.
		compiler = createRequire(process.argv[1])('typescript');
	} catch {
		compiler = undefined;
	}

	return compiler;
};

/**
 * The fixture sides a rule fails to ship. Loading accepts a pack without them —
 * a shipped pack carries no evidence, the way a bundle carries no tests — so
 * this is where the pair is demanded, of the person authoring it.
 */
const missingFixtureSides = async ({ fixturesPath }: { fixturesPath: string }) => {
	const missing: FixtureSide[] = [];

	for (const side of Object.values(FixtureSide)) {
		const entries = await readdir(join(fixturesPath, side)).catch(() => undefined);

		if (entries === undefined || entries.length === 0) {
			missing.push(side);
		}
	}

	return missing;
};

/** The distinct files a run of findings names, capped at three — enough to go looking with, short enough to sit inside one problem line. */
const namePaths = ({ found }: { found: RawStandardsFinding[] }) => {
	const paths = [...new Set(found.flatMap((finding) => finding.files.slice(0, 1).map((file) => file.path)))];

	return paths.length > 3 ? `${paths.slice(0, 3).join(', ')}, …` : paths.join(', ');
};

/**
 * Every checked rule, run against every framework-owned tree the pack ships,
 * expecting silence.
 *
 * This is the standing half of the invariant. A rule's own pass fixture proves
 * the false positive someone already found; this proves the ones nobody has
 * found yet, including in rules that do not exist today — a check that reads
 * paths, names, barrels or tests is held to it the moment it is added, with no
 * fixture of its own to remember.
 *
 * Run as its own pass rather than inside the per-rule loop, which skips a rule
 * whose fixture pair is missing. The invariant is unconditional: a rule owing
 * its author a pass fixture still owes framework-owned code silence.
 */
const checkFrameworkOwned = async ({ pack, compiler }: { pack: LoadedStandardsPack; compiler?: typeof ts }) => {
	const { frameworkOwnedFixturesPath } = pack;
	// Recorded, never required — a pack that holds no rule to the invariant is
	// told so, the same way a judgment-only rule is.
	const heldNothing = { problems: [], notes: [`${pack.name}: no fixtures/framework-owned/ — no rule was held to the framework-owned invariant`] };

	if (frameworkOwnedFixturesPath === undefined) {
		return heldNothing;
	}

	const entries = await readdir(frameworkOwnedFixturesPath, { withFileTypes: true }).catch(() => []);
	// One framework per folder, in name order, so a list of problems reads the
	// same way twice running.
	const frameworks = entries
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();

	if (frameworks.length === 0) {
		return heldNothing;
	}

	const problems: string[] = [];

	for (const framework of frameworks) {
		for (const rule of pack.rules) {
			const { run, inputKind } = rule;

			// Skipped without a word: the per-rule loop already noted a judgment-only
			// rule and a kind this install cannot parse, and saying it again per
			// framework would bury the list it belongs in.
			if (run === undefined || inputKind === undefined || (compiler === undefined && typescriptInputKinds.has(inputKind))) {
				continue;
			}

			try {
				const found = await checkFixtureTree({
					cwd: join(frameworkOwnedFixturesPath, framework),
					rule,
					inputKind,
					run,
					label: `fixtures/framework-owned/${framework}/`,
					compiler,
				});

				if (found.length > 0) {
					problems.push(
						`${rule.id}: the ${framework} framework-owned tree produced ${found.length} finding(s) — a checked rule stays silent on code its framework owns (${namePaths({ found })})`,
					);
				}
			} catch (error) {
				problems.push(`${rule.id}: the ${framework} framework-owned tree could not be checked — ${messageOf({ error })}`);
			}
		}
	}

	return { problems, notes: [] };
};

/**
 * Run every check in a pack against its own fixtures.
 *
 * This is the question load time deliberately does not ask. Loading a pack
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
export const validateStandardsPack = async ({ pack }: Params): Promise<{ problems: string[]; notes: string[] }> => {
	// A built pack was stripped of every fixture on the way out, so each of its
	// rules would report the same two missing sides — hundreds of faults standing
	// for one fact, and none of them the author's to fix. The pack says which it
	// is, rather than this inferring it from the absence: an authored pack that
	// genuinely ships no fixtures yet is a real authoring gap, and it has to keep
	// reading as one.
	if (pack.built) {
		return {
			problems: [
				`${pack.name} is a built pack — its fixtures were left behind when it was built, so there is nothing here to validate. Point --pack at the authored source.`,
			],
			notes: [],
		};
	}

	// Resolving TypeScript means loading a multi-megabyte module; a pack whose
	// rules never ask for a parsed tree should not pay for it.
	const hasParsingRule = pack.rules.some((rule) => rule.inputKind !== undefined && typescriptInputKinds.has(rule.inputKind));
	const compiler = hasParsingRule ? getEngineTypescript() : undefined;
	const problems: string[] = [];
	const notes: string[] = [];

	for (const rule of pack.rules) {
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

		for (const side of Object.values(FixtureSide)) {
			try {
				const found = await checkFixtureTree({ cwd: join(rule.fixturesPath, side), rule, inputKind, run, label: `fixtures/${side}/`, compiler });

				if (side === FixtureSide.Fail && found.length === 0) {
					problems.push(`${rule.id}: the fail fixture produced no finding — the check does not catch what the rule describes`);
				}

				if (side === FixtureSide.Pass && found.length > 0) {
					problems.push(`${rule.id}: the pass fixture produced ${found.length} finding(s) — the check flags code the rule allows`);
				}
			} catch (error) {
				problems.push(`${rule.id}: the ${side} fixture could not be checked — ${messageOf({ error })}`);
			}
		}
	}

	const frameworkOwned = await checkFrameworkOwned({ pack, compiler });

	problems.push(...frameworkOwned.problems);
	notes.push(...frameworkOwned.notes);

	return { problems, notes };
};
