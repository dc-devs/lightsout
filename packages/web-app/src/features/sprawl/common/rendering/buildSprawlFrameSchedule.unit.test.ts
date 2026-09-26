import { describe, expect, test } from '@jest/globals';
import { buildSprawlFrameSchedule } from '#src/features/sprawl/common/rendering/buildSprawlFrameSchedule.ts';
import type { SprawlFrame } from '#src/features/sprawl/internal/common/contracts/SprawlFrame.ts';

const emptyDelta = { files: [], folders: [], removedFiles: [], removedFolders: [], overCap: 0 };

const setupFrames = ({ markers = [false, true, false] }: { markers?: boolean[] } = {}): SprawlFrame[] =>
	markers.map((isRefactorMarker, index) => ({
		sha: `sha${index}`,
		at: '2026-01-01T00:00:00Z',
		subject: `commit ${index}`,
		isRefactorMarker,
		with: emptyDelta,
		without: emptyDelta,
	}));

describe('buildSprawlFrameSchedule', () => {
	test('plays an ordinary commit once', () => {
		expect(buildSprawlFrameSchedule({ frames: setupFrames({ markers: [false, false] }) })).toStrictEqual([0, 1]);
	});

	test('holds a refactor marker, so the move is not gone in a twelfth of a second', () => {
		expect(buildSprawlFrameSchedule({ frames: setupFrames() })).toStrictEqual([0, 1, 1, 1, 2]);
	});

	test('has nothing to play for a history with no frames', () => {
		expect(buildSprawlFrameSchedule({ frames: [] })).toStrictEqual([]);
	});
});
