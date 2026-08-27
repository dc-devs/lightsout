import { describe, expect, test } from '@jest/globals';
import { toRunDetailView } from '#src/features/runDetail/index.ts';
import { buildRunStep } from '#tests/helpers/buildRunStep.ts';
import { buildRunView } from '#tests/helpers/buildRunView.ts';

const setupView = ({ report }: { report?: unknown } = {}) => ({
	view: buildRunView({ overrides: { steps: [buildRunStep({ overrides: { report } })] } }),
});

describe('toRunDetailView', () => {
	test('carries a step report through exactly as the manifest stored it', () => {
		const { view } = setupView({ report: { status: 'complete', summary: 'added the panel' } });

		const detail = toRunDetailView({ view });

		expect(detail.steps[0].report).toStrictEqual({ status: 'complete', summary: 'added the panel' });
	});

	test('reads a step that recorded no report as having none', () => {
		const { view } = setupView();

		const detail = toRunDetailView({ view });

		expect(detail.steps[0].report).toBeUndefined();
	});

	test('drops a report that is no object, since no contract the engine writes is a bare value', () => {
		const { view } = setupView({ report: 'complete' });

		const detail = toRunDetailView({ view });

		expect(detail.steps[0].report).toBeUndefined();
	});

	test('drops a null report rather than showing an empty one', () => {
		const { view } = setupView({ report: null });

		const detail = toRunDetailView({ view });

		expect(detail.steps[0].report).toBeUndefined();
	});

	test('leaves every other field of the step alone', () => {
		const { view } = setupView({ report: { runId: 'abcdef0123456789' } });

		const detail = toRunDetailView({ view });

		expect(detail.steps[0]).toStrictEqual({ ...view.steps[0], report: { runId: 'abcdef0123456789' } });
	});

	test('leaves the run around those steps alone', () => {
		const { view } = setupView();

		const detail = toRunDetailView({ view });

		expect({ ...detail, steps: [] }).toStrictEqual({ ...view, steps: [] });
	});

	test('carries the burn-down through, since the panel that draws it is on the far side of this narrowing', () => {
		const burnDown = { before: 11, after: 0, batchesResolved: 3, batchesDeclined: 0, batches: [], overCap: { before: 7, after: 0 } };
		const view = buildRunView({ overrides: { burnDown } });

		const detail = toRunDetailView({ view });

		expect(detail.burnDown).toStrictEqual(burnDown);
	});
});
