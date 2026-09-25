import { FindingSeverity } from '#src/contracts/plan/grade/FindingSeverity.ts';
import { StructuralCheck } from '#src/contracts/plan/grade/StructuralCheck.ts';
import type { StructuralFinding } from '#src/contracts/plan/grade/StructuralFinding.ts';
import type { ParsedPlan } from '#src/plan/internal/common/types/ParsedPlan.ts';

interface Params {
	plan: ParsedPlan;
	/** The finding label: this file's basename. */
	phase: string;
}

/** Every finding here is blocking and stamped with this check; only what it says and where it points vary. */
const finding = ({ phase, issue, location, fix }: { phase: string; issue: string; location: string; fix: string }) => ({
	check: StructuralCheck.RenamesWellFormed,
	severity: FindingSeverity.Blocking,
	phase,
	issue,
	location,
	fix,
});

/** One finding per bullet that renames a text to itself, or whose new text contains any rename's old text — its own included. */
const renameDefects = ({ plan, phase }: Params) =>
	plan.renames.flatMap((rename) => {
		const location = `${phase}:${rename.line}`;

		if (rename.from === rename.to) {
			return [
				finding({
					phase,
					issue: `the rename of '${rename.from}' renames it to itself`,
					location,
					fix: 'drop the bullet, or name the text it really becomes',
				}),
			];
		}

		const contained = plan.renames.filter((other) => rename.to.includes(other.from)).map((other) => `'${other.from}'`);

		return contained.length === 0
			? []
			: [
					finding({
						phase,
						issue: `the new text '${rename.to}' contains the old text ${contained.join(', ')}, so applying the renames a second time would change the result — and the build's rename check applies them to both sides of every change`,
						location,
						fix: 'rename a longer, more specific text so no new text contains any old one',
					}),
				];
	});

/** A rename-only file writes no new file and states no new behaviour, so it lists nothing to create and no acceptance-test row. */
const renameOnlyDefects = ({ plan, phase }: Params) => {
	const location = `${phase} → Renames`;
	const findings: StructuralFinding[] = [];

	if (plan.createPaths.length > 0) {
		findings.push(
			finding({
				phase,
				issue: `a rename-only file lists files to create (${plan.createPaths.join(', ')}), but a rename moves a file rather than creating one`,
				location,
				fix: 'move the file under Files to Move, or put the new work in a phase that is not rename-only',
			}),
		);
	}

	if (plan.ledger.length > 0) {
		findings.push(
			finding({
				phase,
				issue: `a rename-only file states ${plan.ledger.length} acceptance-test row(s), but a rename adds no behaviour a new test could state and the build writes no tests for it`,
				location,
				fix: 'keep the Acceptance Tests heading with no rows, or put the new behaviour in a phase that is not rename-only',
			}),
		);
	}

	return findings;
};

/**
 * RenamesWellFormed — the `## Renames` section of a rename-only plan file, held
 * to what the build will hold its changes to.
 *
 * Every bullet names exactly two different texts, and no rename's new text
 * contains any rename's old text: that containment rule is what makes applying
 * the renames a second time harmless, which the build's rename check relies on
 * when it applies them to both the starting and the current content of a file.
 * A rename-only file also creates nothing and states no acceptance-test row. The
 * build refuses each of these anyway; catching them here costs a plan edit
 * rather than a failed run.
 */
export const checkRenames = ({ plan, phase }: Params): StructuralFinding[] => [
	...plan.malformedRenameLines.map((line) =>
		finding({
			phase,
			issue: 'a Renames bullet does not name exactly two texts',
			location: `${phase}:${line}`,
			fix: 'write the bullet as the old text and the new text, each in backticks',
		}),
	),
	...renameDefects({ plan, phase }),
	...(plan.renames.length > 0 ? renameOnlyDefects({ plan, phase }) : []),
];
