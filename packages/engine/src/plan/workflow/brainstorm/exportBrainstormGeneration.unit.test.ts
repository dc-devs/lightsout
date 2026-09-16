import { describe, expect, test } from '@jest/globals';

// Dependencies
import { exportBrainstormGeneration } from '#src/plan/workflow/brainstorm/index.ts';
import { planningAlignedFixture } from '#tests/helpers/planningAlignedFixture.ts';

describe('exportBrainstormGeneration', () => {
	test('carries original wording, challenge and exact approval in one aligned generation', async () => {
		const fixture = await planningAlignedFixture({ portable: false });

		const files = exportBrainstormGeneration({ snapshot: fixture.snapshot });

		const core = JSON.parse(files.get('brainstorm-record.json') ?? 'null');
		expect([...files.keys()]).toEqual(['brainstorm-notes.md', 'brainstorm-decisions.json', 'brainstorm-record.json']);
		expect(core.generation).toBe(fixture.snapshot.digest);
		expect(core.record.confirmations).toEqual(fixture.snapshot.record.confirmations);
		expect(core.record.reviewReceipts).toEqual(fixture.snapshot.record.reviewReceipts);
		expect(files.get('brainstorm-notes.md')).toContain(fixture.input.sources[0].text);
		expect(files.get('brainstorm-notes.md')).toContain('Independent challenge:');
	});

	test('refuses an independently challenged design without actual user alignment', async () => {
		const fixture = await planningAlignedFixture({ approved: false });

		expect(() => exportBrainstormGeneration({ snapshot: fixture.snapshot })).toThrow('requires completed notes-bound alignment');
	});
});
