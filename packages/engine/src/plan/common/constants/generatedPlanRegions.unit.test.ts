import { mkdtempSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { type DecisionRow, DecisionSource, type DecisionsRecord } from '#src/contracts/index.ts';
import { generatedPlanRegions } from '#src/plan/common/constants/generatedPlanRegions.ts';
import type { PhaseDeclaration } from '#src/plan/common/types/PhaseDeclaration.ts';
import { renderDecisionLog, writeDecisionLogSection } from '#src/plan/decisionLog/index.ts';
import { parsePlan } from '#src/plan/parsePlan.ts';
import { syncGlobalConstraints, syncPhaseSections } from '#src/plan/sections/index.ts';

// The list names the `##` sections the engine composes rather than an author
// writing, and it is read by the section writers, the structural lint and the
// fingerprint. It has no behaviour of its own, so what holds its members honest
// is the round trip: each writer composes its own section into a plan file, the
// parser reads that file back, and every heading a writer emitted has to arrive
// under the name the list gives it. A heading a writer emits that the list does
// not name leaves the parsed map short.

/** One decision row; only the fields this file varies are parameters. */
const decisionRow = ({ question, choice }: { question: string; choice: string }): DecisionRow => ({
	source: DecisionSource.Elicitation,
	question,
	options: 'this / that',
	choice,
	rationale: 'because it is the cheaper of the two',
	assumption: false,
});

/** A record with one project-wide rule and one ordinary decision, so both composed decision sections have a body. */
const decisions: DecisionsRecord = {
	planName: 'generated-regions',
	decisions: [
		decisionRow({ question: 'Global constraint: every write goes through the store', choice: 'Every write goes through the store' }),
		decisionRow({ question: 'Who writes the log?', choice: 'The engine writes it from the record' }),
	],
};

/** The phase record the overview's two composed phase sections are rendered from. */
const phaseRecord: PhaseDeclaration[] = [
	{
		number: 1,
		file: 'phase1-core.md',
		scope: 'the core of the change',
		createdCount: 2,
		touchedCount: 5,
		creates: ['packages/engine/src/core.ts'],
		exports: ['buildCore'],
		scripts: [],
		fileBudget: 10,
	},
];

/** An overview carrying only authored sections, so every composed section has to be inserted by its own writer. */
const authoredOverview = `# Generated Regions — Overview

## Context

Why this plan exists, in the writer's own words.

## Cross-Phase Dependencies

- Phase 1 hands its builder forward.
`;

/**
 * An overview each writer has composed its own section into, in the order the
 * writers anchor on one another: the constraints section first, the Decision Log
 * above it, then the phase table and the declaration blocks below it.
 */
const setupComposedOverview = async () => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-generated-regions-'));
	const overviewPath = join(dir, 'overview.md');

	writeFileSync(overviewPath, authoredOverview, 'utf8');

	await syncGlobalConstraints({ planPaths: [overviewPath], decisions });
	await writeDecisionLogSection({ path: overviewPath, section: renderDecisionLog({ decisions: decisions.decisions }) });
	await syncPhaseSections({ overviewPath, declarations: phaseRecord, phaseFiles: ['phase1-core.md'] });

	return { content: await readFile(overviewPath, 'utf8') };
};

/** Each parsed region keyed by the heading it arrived under, valued by the file line its range starts at. */
const headingLineOf = ({ content }: { content: string }) => {
	const plan = parsePlan({ content, base: 'overview.md' });

	return Object.fromEntries([...plan.generatedRegionRanges].map(([heading, range]) => [heading, plan.lines[range.start - 1]]));
};

describe('generatedPlanRegions', () => {
	test('generatedPlanRegions: every section the writers compose parses back into generatedRegionRanges under the heading the list names', async () => {
		const overview = await setupComposedOverview();

		const located = headingLineOf({ content: overview.content });

		// four entries and no fifth: each one keyed by the heading the list names,
		// and each range starting at that heading's own line in the file. The listed
		// headings are pinned beside them, so a member the list drops or misspells
		// shows up here rather than silently narrowing what the fingerprint carves out
		expect({ located, listed: [...Object.values(generatedPlanRegions)].sort() }).toStrictEqual({
			located: {
				'Decision Log': '## Decision Log',
				'Global Constraints': '## Global Constraints',
				Phases: '## Phases',
				'Phase Declarations': '## Phase Declarations',
			},
			listed: ['Decision Log', 'Global Constraints', 'Phase Declarations', 'Phases'],
		});
	});
});
