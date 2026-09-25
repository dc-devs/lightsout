import { totalActivityNode } from '#src/activity/common/utils/totalActivityNode.ts';
import type { ActivityLevelKind } from '#src/contracts/activity/ActivityLevelKind.ts';
import type { ActivityMark } from '#src/contracts/activity/ActivityMark.ts';
import { ActivityMarkKind } from '#src/contracts/activity/ActivityMarkKind.ts';
import type { ActivityNode } from '#src/contracts/activity/ActivityNode.ts';
import type { HarnessProcessMark } from '#src/contracts/activity/HarnessProcessMark.ts';
import type { RunStatus } from '#src/contracts/run/RunStatus.ts';

interface Params {
	marks: ActivityMark[];
}

/** One level's folded window, before its children and its totals are attached. */
interface LevelWindow {
	id: string;
	level: ActivityLevelKind;
	label: string;
	parentId?: string;
	startedAt: string;
	endedAt?: string;
	outcome?: RunStatus;
	/** How many start marks carried this id, and how many end marks answered them. */
	starts: number;
	ends: number;
}

type Children = Map<string, LevelWindow[]>;
type Processes = Map<string, HarnessProcessMark[]>;

const isEarlier = ({ left, right }: { left: string; right: string }) => Date.parse(left) < Date.parse(right);

/**
 * Every level id in the record, each folded into one window.
 *
 * A level id appearing in several start marks is one level: several processes
 * each open a plan-kind level for the same plan folder, one per command run,
 * and folding them is what makes those one row rather than several. A level is
 * finished only when every start carrying its id was answered by an end — an
 * unanswered one leaves the window open rather than borrowing the other's end
 * time.
 */
const foldLevels = ({ marks }: Params) => {
	const levels = new Map<string, LevelWindow>();

	for (const mark of marks) {
		if (mark.kind !== ActivityMarkKind.LevelStart) {
			continue;
		}

		const open = levels.get(mark.id);

		if (open === undefined) {
			levels.set(mark.id, {
				id: mark.id,
				level: mark.level,
				label: mark.label,
				parentId: mark.parentId,
				startedAt: mark.at,
				starts: 1,
				ends: 0,
			});
		} else {
			open.starts += 1;
			open.startedAt = isEarlier({ left: mark.at, right: open.startedAt }) ? mark.at : open.startedAt;
		}
	}

	for (const mark of marks) {
		if (mark.kind !== ActivityMarkKind.LevelEnd) {
			continue;
		}

		const open = levels.get(mark.id);

		if (open === undefined) {
			continue;
		}

		open.ends += 1;

		if (open.endedAt === undefined || !isEarlier({ left: mark.at, right: open.endedAt })) {
			open.endedAt = mark.at;
			open.outcome = mark.outcome;
		}
	}

	for (const open of levels.values()) {
		if (open.ends < open.starts) {
			open.endedAt = undefined;
			open.outcome = undefined;
		}
	}

	return levels;
};

/**
 * Each level filed under its parent, and the ones with nowhere to go kept as
 * roots. A level naming a parent no start mark carries is a root rather than a
 * casualty: dropping it would lose recorded time, which is the one thing the
 * fold must never do.
 */
const groupChildren = ({ levels }: { levels: Map<string, LevelWindow> }) => {
	const children: Children = new Map();
	const roots: LevelWindow[] = [];

	for (const open of levels.values()) {
		const parent = open.parentId === undefined ? undefined : levels.get(open.parentId);

		if (parent === undefined) {
			roots.push(open);
		} else {
			children.set(parent.id, [...(children.get(parent.id) ?? []), open]);
		}
	}

	return { children, roots };
};

/**
 * The processes recorded on each level, in the order they were written. A
 * process naming a level nothing ever started is attached to nothing and counts
 * toward no total: it has no window to sit inside, and inventing one would put
 * time where nothing happened.
 */
const groupProcesses = ({ marks, levels }: { marks: ActivityMark[]; levels: Map<string, LevelWindow> }) => {
	const grouped: Processes = new Map();

	for (const mark of marks) {
		if (mark.kind === ActivityMarkKind.HarnessProcess && levels.has(mark.levelId)) {
			grouped.set(mark.levelId, [...(grouped.get(mark.levelId) ?? []), mark]);
		}
	}

	return grouped;
};

interface TreeParams {
	level: LevelWindow;
	children: Children;
	processes: Processes;
}

/** Every process at or below the level — what its totals are computed from. */
const gatherProcesses = ({ level, children, processes }: TreeParams): HarnessProcessMark[] => [
	...(processes.get(level.id) ?? []),
	...(children.get(level.id) ?? []).flatMap((child) => gatherProcesses({ level: child, children, processes })),
];

const buildNode = ({ level, children, processes }: TreeParams): ActivityNode => ({
	id: level.id,
	level: level.level,
	label: level.label,
	startedAt: level.startedAt,
	endedAt: level.endedAt,
	outcome: level.outcome,
	processes: processes.get(level.id) ?? [],
	totals: totalActivityNode({ startedAt: level.startedAt, endedAt: level.endedAt, processes: gatherProcesses({ level, children, processes }) }),
	children: (children.get(level.id) ?? []).map((child) => buildNode({ level: child, children, processes })),
});

/** Fold a flat list of activity marks into the tree of levels it recorded. */
export const nestActivityMarks = ({ marks }: Params): ActivityNode[] => {
	const levels = foldLevels({ marks });
	const processes = groupProcesses({ marks, levels });
	const { children, roots } = groupChildren({ levels });

	return roots.map((level) => buildNode({ level, children, processes }));
};
