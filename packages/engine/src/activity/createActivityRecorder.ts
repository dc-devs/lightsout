import { randomUUID } from 'node:crypto';
import { activityRecordPath } from '#src/activity/activityRecordPath.ts';
import type { ActivityLevel } from '#src/activity/common/types/ActivityLevel.ts';
import { appendActivityMark } from '#src/activity/internal/common/utils/appendActivityMark.ts';
import type { ActivityLevelKind } from '#src/contracts/activity/ActivityLevelKind.ts';
import type { ActivityMark } from '#src/contracts/activity/ActivityMark.ts';
import { ActivityMarkKind } from '#src/contracts/activity/ActivityMarkKind.ts';

interface Params {
	/** The directory the record is written into. The recorder resolves nothing else about it. */
	dir: string;
	level: ActivityLevelKind;
	/** The root level's name, which is also its id. */
	label: string;
}

/** The one append queue a recorder and every handle beneath it share. */
interface Queue {
	write: (mark: ActivityMark) => void;
	settled: () => Promise<void>;
}

const createQueue = ({ path }: { path: string }): Queue => {
	let tail: Promise<unknown> = Promise.resolve();

	return {
		write: (mark) => {
			tail = tail.then(() => appendActivityMark({ path, mark }));
		},
		settled: () => tail.then(() => undefined),
	};
};

const createLevel = ({ id, queue }: { id: string; queue: Queue }): ActivityLevel => {
	let closed = false;

	return {
		id,
		open: ({ level, label }) => {
			const childId = randomUUID();

			queue.write({ kind: ActivityMarkKind.LevelStart, id: childId, parentId: id, level, label, at: new Date().toISOString() });

			return createLevel({ id: childId, queue });
		},
		close: ({ outcome }) => {
			if (closed) {
				return;
			}

			closed = true;
			queue.write({ kind: ActivityMarkKind.LevelEnd, id, at: new Date().toISOString(), outcome });
		},
		recordProcess: (process) => {
			queue.write({ kind: ActivityMarkKind.HarnessProcess, levelId: id, ...process });
		},
		settled: queue.settled,
	};
};

/**
 * Open an activity record in `dir` and answer the root level's handle, having
 * written its start mark.
 *
 * A root level's id is its label, which is what makes the merge rule structural
 * rather than a convention a writer has to remember: several processes opening
 * the same-labelled root land under one id, with none of them ever having to
 * read the file to find out what the others chose. A child level's id is a
 * fresh uuid.
 *
 * Every handle the recorder hands out shares one append queue, so lines land in
 * call order across the whole tree — a nested level can never reach disk before
 * the level it opened inside.
 */
export const createActivityRecorder = ({ dir, level, label }: Params): ActivityLevel => {
	const queue = createQueue({ path: activityRecordPath({ dir }) });

	queue.write({ kind: ActivityMarkKind.LevelStart, id: label, level, label, at: new Date().toISOString() });

	return createLevel({ id: label, queue });
};
