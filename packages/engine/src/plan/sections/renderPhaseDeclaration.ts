import { planSentinelTokens } from '#src/plan/common/constants/planSentinelTokens.ts';
import type { PhaseDeclaration } from '#src/plan/common/types/PhaseDeclaration.ts';

interface Params {
	declaration: PhaseDeclaration;
}

/** The template's own "nothing to declare" spelling, taken from the one declaration of it rather than typed again here. */
const [nothingToDeclare] = planSentinelTokens;

/** One bullet of a declaration block: its values in backtick spans, or the "nothing to declare" spelling when the phase declares nothing under that label. */
const bullet = ({ label, values }: { label: string; values: string[] }) =>
	`- **${label}:** ${values.length === 0 ? nothingToDeclare : values.map((value) => `\`${value}\``).join(', ')}`;

/**
 * One `### Phase <N> — ` declaration block, rendered from one phase record.
 *
 * The exact inverse of the block half of `parsePhaseDeclarations`: a header
 * pairing the phase number with the filename in a backtick span, then the
 * `Creates`, `Exports` and `Scripts` bullets, then the optional `File budget`
 * one. The header's separator is the em dash that parser accepts.
 *
 * The file-budget bullet is written only when the record carries a budget: a
 * bullet stating a budget the phase file never declared is precisely the
 * disagreement the consistency check reports.
 */
export const renderPhaseDeclaration = ({ declaration }: Params): string => {
	const bullets = [
		bullet({ label: 'Creates', values: declaration.creates }),
		bullet({ label: 'Exports', values: declaration.exports }),
		bullet({ label: 'Scripts', values: declaration.scripts }),
		...(declaration.fileBudget === undefined ? [] : [`- **File budget:** ${declaration.fileBudget}`]),
	];

	return `### Phase ${declaration.number} — \`${declaration.file}\`\n\n${bullets.join('\n')}`;
};
