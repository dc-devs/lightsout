import { expect, describe, test } from '@jest/globals';
import { ScanDetector, ScanSeverity, type ScanFinding } from '@/contracts';
import { formatFindingText } from '@/agents/formatFindingText';

const finding = (overrides: Partial<ScanFinding> = {}): ScanFinding => ({
	detector: ScanDetector.Size,
	severity: ScanSeverity.Advisory,
	cluster: 'size:one',
	files: [{ path: 'src/a.ts' }],
	detail: "function 'one' is 114 lines (cap ~80)",
	...overrides,
});

describe('formatFindingText', () => {
	test('carries the guidance alongside the measurement, because a lone number tells an agent nothing', () => {
		const text = formatFindingText({
			finding: finding({ guidance: 'Extract logic. Orchestration that only sequences step calls is exempt — judge before acting.' }),
		});

		// without this the refactor agent reads "114 lines" with no exemption rule
		// and rewrites the orchestration the detector meant to spare
		expect(text).toBe("function 'one' is 114 lines (cap ~80) — Extract logic. Orchestration that only sequences step calls is exempt — judge before acting.");
	});

	test('a detector with nothing to advise contributes no trailing separator', () => {
		expect(formatFindingText({ finding: finding() })).toBe("function 'one' is 114 lines (cap ~80)");
	});
});
