import { join } from 'node:path';
import { type PhaseFile, parsePlan } from '#src/plan/index.ts';

/** What one implementable phase file says it does — every field the cross-phase checks read. */
export interface PhaseSpec {
	create?: string[];
	modify?: string[];
	/** `## Files to Modify from Earlier Phases` — the heading a file an earlier phase creates belongs under. */
	earlierModify?: string[];
	remove?: string[];
	/** `## Files to Move` — one `### ` heading per entry, naming both paths. */
	move?: { from: string; to: string }[];
	/** The Context prose — where a placeholder is planted when a test wants a finding to label. */
	note?: string;
	/** The `## Prerequisites` body — what this phase claims from its predecessor. */
	prerequisites?: string;
	/** The `## What Next Plan Expects` body — what this phase hands forward. */
	handsForward?: string;
	/** `## Verification` — one bullet per command, each in a backtick span. */
	commands?: string[];
	/** The optional `## File Budget` this phase declares for itself. */
	fileBudget?: number;
}

/** One row of the overview's `## Phases` table and the `## Phase Declarations` block that goes with it. */
export interface DeclarationSpec {
	/** The row's phase number; defaults to 1 so a single-phase overview needs only a filename. */
	number?: number;
	file: string;
	scope?: string;
	created?: number;
	touched?: number;
	creates?: string[];
	exports?: string[];
	scripts?: string[];
	/** The optional `- **File budget:**` bullet, omitted when the phase declares none. */
	fileBudget?: number;
}

/** One `## <heading>` section of `### \`path\`` subheadings, or nothing at all when the phase has no such work. */
const pathSection = ({ heading, paths }: { heading: string; paths: string[] }) =>
	paths.length === 0 ? '' : `## ${heading}\n\n${paths.map((path) => `### \`${path}\`\n\nWhat happens to it.\n`).join('\n')}\n`;

/** `## Files to Move`, whose `### ` headings name two paths rather than one. */
const moveSection = ({ moves }: { moves: { from: string; to: string }[] }) =>
	moves.length === 0 ? '' : `## Files to Move\n\n${moves.map(({ from, to }) => `### \`${from}\` → \`${to}\`\n\nWhere it goes.\n`).join('\n')}\n`;

/** The optional `## File Budget` section, absent when the phase takes the configured default. */
const budgetSection = ({ fileBudget }: { fileBudget?: number }) => (fileBudget === undefined ? '' : `## File Budget\n\n${fileBudget}\n\n`);

/** One bullet of a declaration block: its backticked values, or the template's `none` sentinel when it declares nothing. */
const declarationBullet = ({ label, values }: { label: string; values: string[] }) =>
	`- **${label}:** ${values.length === 0 ? 'none' : values.map((value) => `\`${value}\``).join(', ')}`;

/** One `### Phase <n> — \`<file>\`` block of the overview's `## Phase Declarations`. */
const declarationBlock = ({ row }: { row: DeclarationSpec }) => {
	const budget = row.fileBudget === undefined ? '' : `\n- **File budget:** ${row.fileBudget}`;

	return `### Phase ${row.number ?? 1} — \`${row.file}\`

${declarationBullet({ label: 'Creates', values: row.creates ?? [] })}
${declarationBullet({ label: 'Exports', values: row.exports ?? [] })}
${declarationBullet({ label: 'Scripts', values: row.scripts ?? [] })}${budget}
`;
};

/** One implementable phase file: every required section present, and only the path headings the spec asks for. */
export const phaseBody = ({
	create = [],
	modify = [],
	earlierModify = [],
	remove = [],
	move = [],
	note = 'One phase of a phased plan.',
	prerequisites = '- None',
	handsForward = 'The next phase builds on this one.',
	commands = ['true'],
	fileBudget,
}: PhaseSpec = {}) => {
	const paths = [
		pathSection({ heading: 'Files to Create', paths: create }),
		pathSection({ heading: 'Files to Modify', paths: modify }),
		pathSection({ heading: 'Files to Modify from Earlier Phases', paths: earlierModify }),
		pathSection({ heading: 'Files to Delete', paths: remove }),
		moveSection({ moves: move }),
		budgetSection({ fileBudget }),
	].join('');

	return `# Phase

## Context

${note}

## Global Constraints

- None

## Prerequisites

${prerequisites}

${paths}## Scope Boundaries

**Do NOT:** wander.

## Verification

${commands.map((command) => `- \`${command}\` — gates green`).join('\n')}

## What Next Plan Expects

${handsForward}
`;
};

/** The overview file, whose presence alone is what makes a deliverable phased, carrying one table row and one declaration block per phase. */
export const overviewBody = ({ rows }: { rows: DeclarationSpec[] }) => `# Demo — Overview

## Global Constraints

- None

## Phases

| # | File | Scope | Creates | Touches |
|---|------|-------|---------|---------|
${rows.map((row) => `| ${row.number ?? 1} | \`${row.file}\` | ${row.scope ?? 'the work'} | ${row.created ?? 0} | ${row.touched ?? 0} |`).join('\n')}

## Phase Declarations

${rows.map((row) => declarationBlock({ row })).join('\n')}
## Cross-Phase Dependencies

- Later phases build on earlier ones.
`;

/** One `PhaseFile` as `lintPlanStructure` builds it: the body parsed once, labelled by its basename, numbered from its name. */
export const phaseFile = ({ base, body, dir = '/plans/demo' }: { base: string; body: string; dir?: string }): PhaseFile => ({
	path: join(dir, base),
	base,
	number: base === 'overview.md' ? 0 : Number(/^phase(\d+)-/.exec(base)?.[1] ?? 1),
	plan: parsePlan({ content: body, base }),
});
