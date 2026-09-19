import { mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import type { PhaseDeclaration } from '#src/plan/common/types/PhaseDeclaration.ts';
import { parsePhaseDeclarations } from '#src/plan/parsePhaseDeclarations.ts';
import { parsePlan } from '#src/plan/parsePlan.ts';
import { syncPhaseSections } from '#src/plan/sections/index.ts';
import { declaredRecord } from '#tests/helpers/declaredRecord.ts';

// The overview's `## Phases` table and its `## Phase Declarations` blocks state
// the same phase's size and hand-offs twice, so this rewrites both from one
// record and the two cannot disagree. Every other section of the overview is the
// agent's, and a sync that already matches the record writes nothing at all.

/** The one authoritative record both copies are rendered from. */
const phaseRecord: PhaseDeclaration[] = [
	{
		number: 1,
		file: 'phase1-core.md',
		scope: 'the core of the change',
		createdCount: 3,
		touchedCount: 7,
		creates: ['packages/engine/src/core.ts'],
		exports: ['buildCore', 'CoreOptions'],
		scripts: ['check:core'],
		fileBudget: 12,
	},
	{
		number: 2,
		file: 'phase2-extra.md',
		scope: 'the wiring that follows it',
		createdCount: 1,
		touchedCount: 4,
		creates: ['packages/engine/src/extra.ts'],
		exports: ['buildExtra'],
		scripts: [],
		fileBudget: 9,
	},
];

/**
 * What `parsePhaseDeclarations` hands back for malformed input, which it
 * deliberately preserves rather than rejecting: an orphan block carrying no
 * `## Phases` row comes back numbered zero, and a row may name a file this
 * deliverable does not have at all.
 */
const unmatchedRecord: PhaseDeclaration[] = [
	{
		number: 0,
		file: 'phase1-core.md',
		scope: '',
		createdCount: undefined,
		touchedCount: undefined,
		creates: [],
		exports: [],
		scripts: [],
		fileBudget: undefined,
	},
	{
		number: 1,
		file: 'phase9-elsewhere.md',
		scope: 'a phase of some other deliverable',
		createdCount: 1,
		touchedCount: 1,
		creates: [],
		exports: [],
		scripts: [],
		fileBudget: undefined,
	},
];

/** The table rows a writer typed by hand, stating a size the record disagrees with. */
const staleRows = `| 1 | \`phase1-core.md\` | the scope the writer first typed | 9 | 9 |
| 2 | \`phase2-extra.md\` | the other scope the writer first typed | 9 | 9 |`;

/** The declaration blocks the same writer typed, stating hand-offs the record disagrees with. */
const staleBlocks = `### Phase 1 — \`phase1-core.md\`

- **Creates:** \`packages/engine/src/stale.ts\`
- **Exports:** \`staleSymbol\`
- **Scripts:** none
- **File budget:** 99

### Phase 2 — \`phase2-extra.md\`

- **Creates:** none
- **Exports:** none
- **Scripts:** none`;

/** An overview whose only variable parts are the two phase sections; every other section is fixed, so a diff outside them is visible. */
const overviewBody = ({ rows, blocks }: { rows: string; blocks: string }) => `# Focused Drafting — Overview

## Context

why this plan exists, in the writer's own words.

## Architecture

three layers, each usable before the one above it exists.

## Phases

| # | File | Scope | Creates | Touches |
|---|------|-------|---------|---------|
${rows}

## Phase Declarations

${blocks}

## Cross-Phase Dependencies

- Phase 2 depends on Phase 1's exported builder.
`;

/** One `##` section's body — the lines under its heading, up to the next `##` heading. */
const sectionOf = ({ text, heading }: { text: string; heading: string }) => {
	const lines = text.split('\n');
	const start = lines.findIndex((line) => line === `## ${heading}`);

	if (start === -1) {
		return '';
	}

	const rest = lines.slice(start + 1);
	const next = rest.findIndex((line) => line.startsWith('## '));

	return (next === -1 ? rest : rest.slice(0, next)).join('\n');
};

/**
 * What the overview now declares, read back through the parser the lint uses —
 * the table and the blocks joined into one row per phase, with the lines the
 * parser reports each span at left out: where a span sits is not part of the
 * record this sync renders from.
 */
const declaredBy = ({ text }: { text: string }) =>
	declaredRecord({ declarations: parsePhaseDeclarations({ plan: parsePlan({ content: text, base: 'overview.md' }) }) });

/** An overview on disk, backdated so that any rewrite moves its modification time. */
const setupOverview = ({ rows = staleRows, blocks = staleBlocks }: { rows?: string; blocks?: string } = {}) => {
	const workspaceDir = mkdtempSync(join(tmpdir(), 'lightsout-phase-sections-'));
	const overviewPath = join(workspaceDir, 'overview.md');
	const content = overviewBody({ rows, blocks });

	writeFileSync(overviewPath, content, 'utf8');

	const backdate = () => {
		const backdated = new Date('2020-01-01T00:00:00.000Z');

		utimesSync(overviewPath, backdated, backdated);
	};

	backdate();

	return {
		overviewPath,
		declarations: phaseRecord,
		phaseFiles: ['phase1-core.md', 'phase2-extra.md'],
		original: content,
		backdate,
		readOverview: () => readFileSync(overviewPath, 'utf8'),
		modifiedAt: () => statSync(overviewPath).mtimeMs,
	};
};

/** An overview carrying the constraints section the phase table is placed below, and neither phase section for the sync to replace. */
const overviewWithoutPhaseSections = `# Focused Drafting — Overview

## Context

why this plan exists, in the writer's own words.

## Global Constraints

- every write goes through the store

## Cross-Phase Dependencies

- Phase 2 depends on Phase 1's exported builder.
`;

/** The same overview on disk, carrying neither phase section, so the sync has to place both rather than replace them. */
const setupOverviewWithoutPhaseSections = () => {
	const workspaceDir = mkdtempSync(join(tmpdir(), 'lightsout-phase-sections-placed-'));
	const overviewPath = join(workspaceDir, 'overview.md');

	writeFileSync(overviewPath, overviewWithoutPhaseSections, 'utf8');

	return {
		overviewPath,
		declarations: phaseRecord,
		phaseFiles: ['phase1-core.md', 'phase2-extra.md'],
		readOverview: () => readFileSync(overviewPath, 'utf8'),
	};
};

describe('syncPhaseSections', () => {
	test('rewrites the phase table and the declaration blocks from one record so the two agree', async () => {
		const overview = setupOverview();

		const written = await syncPhaseSections({
			overviewPath: overview.overviewPath,
			declarations: overview.declarations,
			phaseFiles: overview.phaseFiles,
		});

		// reading both sections back through the parser joins the table half and the
		// block half into one row per phase: it can only equal the record when the
		// scope and counts from the table and the hand-offs from the blocks were all
		// rendered from it, so a stale copy of either half fails here
		expect({ written, declared: declaredBy({ text: overview.readOverview() }) }).toStrictEqual({
			written: { path: overview.overviewPath, updated: true },
			declared: phaseRecord,
		});
	});

	test('leaves an overview that already matches the record unwritten', async () => {
		const overview = setupOverview();
		// the first sync is the arrangement: it is what makes the file match the
		// record, and backdating afterwards means a second write would show up
		await syncPhaseSections({ overviewPath: overview.overviewPath, declarations: overview.declarations, phaseFiles: overview.phaseFiles });
		overview.backdate();
		const synced = overview.readOverview();
		const modifiedAt = overview.modifiedAt();

		const written = await syncPhaseSections({
			overviewPath: overview.overviewPath,
			declarations: overview.declarations,
			phaseFiles: overview.phaseFiles,
		});

		expect({ written, text: overview.readOverview(), modifiedAt: overview.modifiedAt() }).toStrictEqual({
			written: { path: overview.overviewPath, updated: false },
			text: synced,
			modifiedAt,
		});
	});

	test('leaves every section other than Phases and Phase Declarations untouched', async () => {
		const overview = setupOverview();

		const written = await syncPhaseSections({
			overviewPath: overview.overviewPath,
			declarations: overview.declarations,
			phaseFiles: overview.phaseFiles,
		});

		const after = overview.readOverview();
		// the design sections have to survive byte-for-byte, and the changed phase
		// table proves the sync did run rather than passing by doing nothing
		expect({
			updated: written.updated,
			context: sectionOf({ text: after, heading: 'Context' }),
			architecture: sectionOf({ text: after, heading: 'Architecture' }),
			dependencies: sectionOf({ text: after, heading: 'Cross-Phase Dependencies' }),
			phasesRewritten: sectionOf({ text: after, heading: 'Phases' }) !== sectionOf({ text: overview.original, heading: 'Phases' }),
		}).toStrictEqual({
			updated: true,
			context: sectionOf({ text: overview.original, heading: 'Context' }),
			architecture: sectionOf({ text: overview.original, heading: 'Architecture' }),
			dependencies: sectionOf({ text: overview.original, heading: 'Cross-Phase Dependencies' }),
			phasesRewritten: true,
		});
	});

	test('writes nothing when no declaration matches a phase file of the deliverable', async () => {
		const overview = setupOverview();
		const modifiedAt = overview.modifiedAt();

		const written = await syncPhaseSections({
			overviewPath: overview.overviewPath,
			declarations: unmatchedRecord,
			phaseFiles: overview.phaseFiles,
		});

		// rendering these would write a `### Phase 0 — ` heading no agent authored
		// and drop the other agent-authored block outright, so the whole sync is a
		// no-op: both sections survive untouched for the round's lint to report
		expect({ written, text: overview.readOverview(), modifiedAt: overview.modifiedAt() }).toStrictEqual({
			written: { path: overview.overviewPath, updated: false },
			text: overview.original,
			modifiedAt,
		});
	});

	test('places both missing phase sections on their anchors — the table below the constraints, the blocks below the table', async () => {
		const overview = setupOverviewWithoutPhaseSections();

		const written = await syncPhaseSections({
			overviewPath: overview.overviewPath,
			declarations: overview.declarations,
			phaseFiles: overview.phaseFiles,
		});

		const after = overview.readOverview();
		// neither section is there to replace, so each one's anchor alone decides
		// where it lands; reading the record back off the placed sections proves
		// they are the rendered ones rather than two headings in the right order
		expect({
			written,
			headings: after.split('\n').filter((line) => line.startsWith('## ')),
			declared: declaredBy({ text: after }),
		}).toStrictEqual({
			written: { path: overview.overviewPath, updated: true },
			headings: ['## Context', '## Global Constraints', '## Phases', '## Phase Declarations', '## Cross-Phase Dependencies'],
			declared: phaseRecord,
		});
	});
});
