import { formatCost } from '@lightsout/shared';
import { renderProgressBlock } from '#src/cli/common/progressBlock/renderProgressBlock.ts';
import { formatClockDuration } from '#src/cli/common/utils/formatClockDuration.ts';
import { plural } from '#src/cli/common/utils/plural.ts';
import type { RunProgress, RunProgressRow } from '#src/views/index.ts';

const collapseWhitespace = ({ text }: { text: string }) => text.replace(/\s+/g, ' ').trim();

/**
 * A labelled diagnostic wrapped onto as many lines as it needs, the label on the
 * first and the rest hanging under its text — the shape the single-line entries
 * beside it already read as, so a long one does not become a different kind of
 * row.
 */
const wrapLabelled = ({ label, text }: { label: string; text: string }) => {
	// The block's rules span its widest line, so one long unwrapped line does not
	// overflow — it drags the rules out with it, and a supervisor diagnosis runs
	// to several hundred characters. A fixed ceiling keeps the block the shape the
	// layout was chosen as, and the rules still grow for a long step id the way
	// they always did.
	const diagnosisWidth = 96;
	const indent = ` ${label.padEnd('last output'.length)}   `;
	const width = Math.max(diagnosisWidth - indent.length, 1);
	const lines: string[] = [];
	let rest = text;

	while (rest.length > width) {
		const cut = rest.lastIndexOf(' ', width);
		const at = cut > 0 ? cut : width;

		lines.push(rest.slice(0, at));
		rest = rest.slice(at).trimStart();
	}

	lines.push(rest);

	return lines.map((line, index) => `${index === 0 ? indent : ' '.repeat(indent.length)}${line}`);
};

const verificationLines = ({ row }: { row: RunProgressRow }) => {
	const verification = row.verification;

	if (!verification || verification.failedFamilies.length === 0) {
		return [];
	}

	const groups = [...new Set(verification.failures.map((failure) => failure.group))];
	const repairs = Object.entries(verification.repairAttempts);
	const lastOutput = verification.failures
		.at(-1)
		?.outputTail?.split(/\r?\n/)
		.map((line) => collapseWhitespace({ text: line }))
		.filter(Boolean)
		.at(-1);
	const lines = [
		` verification  ${verification.failedFamilies.join(', ')} · groups ${groups.length === 0 ? 'unavailable' : groups.join(', ')} · repairs ${repairs.length === 0 ? 'none' : repairs.map(([family, attempts]) => `${family}=${attempts}`).join(', ')} · guided ${verification.guidedRepairAttempted ? 'yes' : 'no'}`,
	];

	if (verification.supervisorDiagnosis) {
		lines.push(...wrapLabelled({ label: 'diagnosis', text: collapseWhitespace({ text: verification.supervisorDiagnosis }) }));
	}

	if (lastOutput) {
		lines.push(` last output   ${lastOutput}`);
	}

	return lines;
};

/**
 * What the bounded cleanup pass has spent and what it is leaving behind, on the
 * diagnostic line beside the verification one — two budgets, never one number.
 *
 * A record with no reason yet is a cleanup still running, or a run parked
 * mid-loop: it reads as in progress rather than borrowing a reason that never
 * happened. A count is named only when there is one, and each is labelled the
 * way this block labels everything — name first, then the number — so the line
 * reads as the verification line beside it does.
 */
const cleanupLines = ({ row }: { row: RunProgressRow }) => {
	const cleanup = row.cleanup;

	if (cleanup === undefined) {
		return [];
	}

	const parts = [`${cleanup.rounds} round${plural({ count: cleanup.rounds })}`, cleanup.endReason ?? 'in progress'];

	if (cleanup.remainingFindings > 0) {
		parts.push(`remaining ${cleanup.remainingFindings}`);
	}

	if (cleanup.carriedFindings > 0) {
		parts.push(`carried ${cleanup.carriedFindings}`);
	}

	if (cleanup.failures > 0) {
		parts.push(`failed ${cleanup.failures}`);
	}

	return [` cleanup       ${parts.join(' · ')}`];
};

interface Params {
	progress: RunProgress;
}

/**
 * A run's progress block as lines: a title line, a rule, one row per step, a
 * closing rule, the totals, and what the run is doing now.
 *
 * Pure — data in, strings out — because this is the ONE rendering of the
 * block. The chat view and the terminal view are the same bytes, so the layout
 * can be held to the character without a run to look at.
 *
 * The rules span the widest row rather than the 46 columns the chosen sample
 * drew them at. That width follows from no column and could not survive a
 * longer step id, which would leave the rules narrower still than the rows they
 * bracket — read as a drawing error rather than a choice. It is the one
 * departure from the sample; every other line reproduces it character for
 * character.
 *
 * The geometry — title padding, rule widths, row columns and glyph paint —
 * lives in `renderProgressBlock`, which the planning block shares; this file
 * owns what is particular to a run: its diagnostics and its totals.
 */
export const renderRunProgress = ({ progress }: Params): string[] => {
	const diagnostics = progress.rows.flatMap((row) => [...verificationLines({ row }), ...cleanupLines({ row })]);
	const cost = progress.costUsd === undefined ? '' : ` · ${formatCost({ usd: progress.costUsd })}`;
	const totals = `elapsed ${formatClockDuration({ ms: progress.elapsedMs })} · ${progress.changedFileCount} files${cost}`;

	return renderProgressBlock({ title: progress.title, tag: progress.shortId, rows: progress.rows, diagnostics, totals, now: progress.now });
};
