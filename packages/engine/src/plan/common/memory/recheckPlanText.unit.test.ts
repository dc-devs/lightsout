import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { recheckPlanText } from '#src/plan/common/memory/recheckPlanText.ts';

const firstPhaseText = '# Phase 1\n\n## Decision Log\n\nThe reader is spawned once per plan file.\n';
const secondPhaseText = '# Phase 2\n\n## Decision Log\n\nThe judge is spawned once per finding.\n';
const overviewLine = 'This deliverable is graded as two phases and one overview.';
const overviewText = `# Overview\n\n${overviewLine}\n`;

/** A two-phase deliverable with an overview — the shape a record's phase label is looked up against. */
const setupDeliverable = ({ overview = overviewText }: { overview?: string } = {}) => {
	const planDir = join('/repo', '.lightsout', 'plans', 'lo-126');

	return {
		files: [
			{ path: join(planDir, 'phase-1-reader.md'), text: firstPhaseText },
			{ path: join(planDir, 'phase-2-judge.md'), text: secondPhaseText },
		],
		overviewText: overview,
	};
};

describe('recheckPlanText', () => {
	test("a record's check text is its phase file, or the whole plan when the phase is not one", () => {
		const { files, overviewText: overview } = setupDeliverable();

		const ownFile = recheckPlanText({ files, overviewText: overview, phase: 'phase-2-judge.md' });
		const overviewLabelled = recheckPlanText({ files, overviewText: overview, phase: 'overview.md' });
		const vanishedPhase = recheckPlanText({ files, overviewText: overview, phase: 'phase-3-resplit-away.md' });

		// a record raised against a file the deliverable still holds is re-checked
		// against that file's current text and nothing else
		expect(ownFile).toBe(secondPhaseText);
		// a record the documentation checker stamped with the overview, and one
		// whose phase file a resplit renamed away, both get every plan file — a
		// record that could never be re-verified would block until a human deleted
		// the memory
		expect(overviewLabelled).toEqual(expect.stringContaining(overviewLine));
		expect(overviewLabelled).toEqual(expect.stringContaining(`## Plan file: phase-1-reader.md\n\n${firstPhaseText}`));
		expect(overviewLabelled).toEqual(expect.stringContaining(`## Plan file: phase-2-judge.md\n\n${secondPhaseText}`));
		expect(vanishedPhase).toBe(overviewLabelled);
	});

	test('a plan with no overview is rendered from its plan files alone', () => {
		const { files } = setupDeliverable();

		const wholePlan = recheckPlanText({ files, phase: 'phase-3-resplit-away.md' });

		// a record the deliverable no longer holds still has to be checked against
		// something, and a plan with no overview has only its phase files to give
		expect(wholePlan).toBe(`## Plan file: phase-1-reader.md\n\n${firstPhaseText}\n\n## Plan file: phase-2-judge.md\n\n${secondPhaseText}`);
	});
});
