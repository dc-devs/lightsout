import { basename, join } from 'node:path';
import { FindingSeverity, StructuralCheck, type StructuralFinding } from '#src/contracts/index.ts';
import { isPathToken } from '#src/plan/common/paths/isPathToken.ts';
import { pathExists } from '#src/plan/common/paths/pathExists.ts';
import type { ParsedPlan } from '#src/plan/common/types/ParsedPlan.ts';
import type { RepoPathIndex } from '#src/plan/common/types/RepoPathIndex.ts';
import { getCodeSpans } from '#src/plan/common/utils/getCodeSpans.ts';
import { getPlanNamedPaths } from '#src/plan/common/utils/getPlanNamedPaths.ts';

interface Params {
	plan: ParsedPlan;
	cwd: string;
	/** Absolute path to the plan file — its basename anchors each finding's location. */
	planPath: string;
	/** The finding label: this file's basename. */
	phase: string;
	/** Every path ANY file in this deliverable creates or moves to — `provenance.createdBy`'s keys, deliverable-wide rather than phase-ordered. */
	planned: Set<string>;
	/** The working tree, read once per lint run. */
	index: RepoPathIndex;
}

/** Whether one name is the other file, exactly or as a segment-aligned tail of it: `views/getRunView.ts` is `src/contracts/views/getRunView.ts` and is never `src/myviews/getRunView.ts`. */
const isTailOf = ({ candidate, path }: { candidate: string; path: string }) => path === candidate || path.endsWith(`/${candidate}`);

/**
 * The repo-relative name a backticked span claims, or undefined when the span
 * claims no single file.
 *
 * Four shapes are refused outright. A span holding whitespace is a command
 * (`node scripts/build.mjs`), not a path. A span holding `://` is a URL and one
 * starting with `/` is an absolute filesystem path — plans cite both, and
 * neither can ever tail-match a repo-relative entry. A span holding `*`, `${`
 * or `<` names a FAMILY of files rather than one: a Prior Art search is written
 * as a glob, a fenced snippet legitimately joins a variable to a filename, and
 * `.lightsout/runs/<id>/worklist.json` is correct as written. Fenced lines are
 * otherwise read like any other, because an import specifier inside a code
 * block is a real claim about a real file.
 *
 * What survives is stripped of the leading segments authors write to say "from
 * here down": an import alias (`#src`, `@`), a relative anchor (`.`, `..`), and
 * an elision (`...`, `…`). A leading elision leaves exactly the tail the
 * shorthand match already resolves, so it is recovered; an elision left in the
 * MIDDLE leaves nothing a tail can recover, so it is refused rather than guessed
 * at. A leading `.lightsout` is untouched — the rule is "made entirely of dots".
 */
const normalizeCandidate = ({ token }: { token: string }) => {
	if (/\s/.test(token) || token.includes('*') || token.includes('${') || token.includes('<') || token.includes('://') || token.startsWith('/')) {
		return undefined;
	}

	const segments = token.split('/');

	while (segments.length > 0 && (/^[.…]+$/.test(segments[0]) || segments[0].startsWith('#') || segments[0].startsWith('@'))) {
		segments.shift();
	}

	const candidate = segments.join('/');

	return candidate.includes('/') && !candidate.includes('...') && !candidate.includes('…') ? candidate : undefined;
};

/** Every distinct path a plan's backticked spans claim, mapped to the first 1-based line it appeared on. */
const collectCandidates = ({ plan }: { plan: ParsedPlan }) => {
	const candidates = new Map<string, number>();

	for (const [index, line] of plan.lines.entries()) {
		for (const token of getCodeSpans({ line })) {
			const candidate = isPathToken({ token }) ? normalizeCandidate({ token }) : undefined;

			if (candidate !== undefined && !candidates.has(candidate)) {
				candidates.set(candidate, index + 1);
			}
		}
	}

	return candidates;
};

/**
 * The paths this deliverable already answers for: every path this file's own
 * headings name, plus every path ANY file in the deliverable creates or moves
 * to. Those belong to `checkPlanPaths`, so one wrong path never produces two
 * findings from two checks.
 *
 * `planned` is deliverable-wide rather than the phase-ordered `providedBefore`
 * `checkPlanPaths` takes, because the two ask different questions: that check
 * asks whether a path exists when a phase runs, this one asks whether the name
 * is real at all. Phase-ordered subtraction would break a phased plan outright —
 * `overview.md` has no earlier phase and no file sections, so every path its
 * `## Phase Declarations` names would be reported missing at draft time, which
 * is exactly when the repair loop runs.
 */
const getAccountedPaths = ({ plan, planned }: { plan: ParsedPlan; planned: Set<string> }) => [
	...new Set([...getPlanNamedPaths({ plan, includeMirrors: true }), ...planned]),
];

/**
 * Whether the working tree holds the file a candidate names.
 *
 * An anchored candidate — one whose first segment is a directory at the repo
 * root — is `stat`ed, so the filesystem stays the authority for a genuinely
 * repo-rooted path, including one the walk pruned. A miss falls THROUGH to the
 * tail match rather than reporting: several top-level names in a repo also
 * occur nested (`scripts`, `docs`, `fixtures`, `coverage`), and normalization
 * makes the collision likelier still, because stripping a leading `#src` can
 * leave a tail whose new first segment is a top-level name.
 */
const isCandidateOnDisk = async ({ candidate, cwd, index }: { candidate: string; cwd: string; index: RepoPathIndex }) => {
	const anchored = index.topLevelDirs.has(candidate.split('/')[0]) && (await pathExists({ path: join(cwd, candidate) }));

	return anchored || index.files.some((path) => isTailOf({ candidate, path }));
};

/**
 * ProsePathExists — a backticked span naming a file the working tree does not
 * hold, anywhere in the plan rather than only under its file headings.
 *
 * `checkPlanPaths` reads the `### ` heading paths and the mirror bullets; a
 * wrong path in a Context paragraph, in per-file prose or in Prior Art belonged
 * to nobody and survived into implementation, where a fresh-context agent opens
 * a file that moved months ago. The convention that makes this decidable is
 * stated in the plan template: backticks around a path assert the file exists,
 * and a path written to illustrate a shape goes in plain prose.
 *
 * It blocks, because fixing bad paths is the point: only blocking findings reach
 * the draft repair loop's correcting agent, so an advisory one would be printed
 * and left standing. That makes precision load-bearing — every span this cannot
 * decide is skipped rather than guessed at, and an index that came back empty
 * reports nothing at all.
 */
export const checkProsePaths = async ({ plan, cwd, planPath, phase, planned, index }: Params): Promise<StructuralFinding[]> => {
	// An empty pool is evidence the walk failed or that `cwd` is not the repo
	// root, never that nothing exists. Judging against it would turn every
	// backticked path in the plan into a blocking finding the repair loop can
	// never clear — a silent, total failure.
	if (index.files.length === 0) {
		return [];
	}

	const accounted = getAccountedPaths({ plan, planned });
	const findings: StructuralFinding[] = [];

	for (const [candidate, line] of collectCandidates({ plan })) {
		if (accounted.some((path) => isTailOf({ candidate, path }))) {
			continue;
		}

		if (!(await isCandidateOnDisk({ candidate, cwd, index }))) {
			findings.push({
				check: StructuralCheck.ProsePathExists,
				severity: FindingSeverity.Blocking,
				phase,
				issue: `path named in prose does not exist: ${candidate}`,
				location: `${basename(planPath)}:${line}`,
				fix: 'correct the path, or drop the backticks if the span is not naming a real file',
			});
		}
	}

	return findings;
};
