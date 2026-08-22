import { describe, expect, test } from '@jest/globals';
import { FindingSeverity, StructuralCheck, type StructuralFinding } from '#src/contracts/index.ts';
import { getBlockingFindings } from '#src/plan/index.ts';

/** One finding per severity given, each identifiable by its issue text so order is assertable. */
const setupFindings = ({ severities }: { severities: FindingSeverity[] }) => {
	const findings: StructuralFinding[] = severities.map((severity, index) => ({
		check: severity === FindingSeverity.Advisory ? StructuralCheck.ScopeWithinGuardrail : StructuralCheck.PathExists,
		severity,
		phase: `phase${index + 1}-work.md`,
		issue: `issue ${index + 1}`,
		location: `phase${index + 1}-work.md`,
		fix: `fix ${index + 1}`,
	}));

	return { findings };
};

describe('getBlockingFindings', () => {
	test('only the blocking findings come back, in the order the lint reported them', () => {
		const { findings } = setupFindings({
			severities: [FindingSeverity.Advisory, FindingSeverity.Blocking, FindingSeverity.Advisory, FindingSeverity.Blocking],
		});

		const blocking = getBlockingFindings({ findings });

		// an advisory counted here would fail a plan that has no defect — the whole
		// reason every gate reads this rather than a length
		expect(blocking.map((finding) => finding.issue)).toStrictEqual(['issue 2', 'issue 4']);
	});

	test.each<{ label: string; severities: FindingSeverity[] }>([
		{ label: 'advisories only', severities: [FindingSeverity.Advisory, FindingSeverity.Advisory] },
		{ label: 'nothing at all', severities: [] },
	])('$label gates nothing', ({ severities }) => {
		const { findings } = setupFindings({ severities });

		const blocking = getBlockingFindings({ findings });

		expect(blocking).toStrictEqual([]);
	});
});
