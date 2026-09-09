import { testWriterConcurrency } from '#src/pipeline/common/constants/testWriterConcurrency.ts';
import type { TestTargetGroup } from '#src/pipeline/common/types/TestTargetGroup.ts';
import type { WriterResult } from '#src/pipeline/common/types/WriterResult.ts';

interface Params {
	groups: TestTargetGroup[];
	spawnWriter: ({ group }: { group: TestTargetGroup }) => Promise<WriterResult>;
	aggregate: { collect: (params: { result: WriterResult }) => Promise<void>; isParked: () => boolean };
	warm: { spawn: Promise<WriterResult>; group: TestTargetGroup } | undefined;
	collectWarm: () => Promise<void>;
}

// The subject files writers currently hold. Two writers must never hold one
// file: they would edit the same test on disk.
const createSubjectReservations = () => {
	const held = new Set<string>();

	return {
		isFree: ({ group }: { group: TestTargetGroup }) => group.subjects.every((subject) => !held.has(subject)),
		reserve: ({ group }: { group: TestTargetGroup }) => {
			for (const subject of group.subjects) {
				held.add(subject);
			}
		},
		release: ({ group }: { group: TestTargetGroup }) => {
			for (const subject of group.subjects) {
				held.delete(subject);
			}
		},
	};
};

// The first waiting assignment whose subjects are all free wins, in queue
// order; taking it removes it from the queue. Undefined when every waiting
// assignment is blocked by a running writer.
const takeEligible = ({ waiting, reservations }: { waiting: TestTargetGroup[]; reservations: ReturnType<typeof createSubjectReservations> }) => {
	const group = waiting.find((candidate) => reservations.isFree({ group: candidate }));

	if (group) {
		waiting.splice(waiting.indexOf(group), 1);
	}

	return group;
};

/**
 * Drain the assignments through `testWriterConcurrency` slots, launching the
 * first waiting assignment whose subject files no running writer holds. Subject
 * collision — two writers editing one file on disk — is the only exclusion that
 * matters, so an assignment blocked on a held file is passed over rather than
 * left holding a slot, and a released file wakes whatever waited on it.
 *
 * The warm-up writer counts inside the ceiling and keeps its own subjects
 * reserved until it settles. On every settle, pool writer or warm-up alike, the
 * order is fixed: release the reservation, fold the result in, and only then
 * look for the next eligible assignment — the park flag is set while folding
 * in, so scanning first would launch one more writer past a rate limit the run
 * has already hit.
 *
 * Every reservation is held by a running writer, so when nothing runs the first
 * waiting assignment is always eligible: the drain cannot deadlock. Nothing is
 * polled — eligibility is re-examined only when a writer settles.
 *
 * @param groups - the assignments the warm-up writer did not claim, in the fan-out's queue order
 * @param spawnWriter - spawns one writer for one assignment
 * @param aggregate - collects every result and answers whether the run parked
 * @param warm - the warm-up writer in flight and the assignment it holds
 * @param collectWarm - folds the warm-up result in, once and only once
 */
export const drainBySubjects = async ({ groups, spawnWriter, aggregate, warm, collectWarm }: Params): Promise<void> => {
	const reservations = createSubjectReservations();
	const waiting = [...groups];
	const running = new Map<number, Promise<void>>();
	let nextTicket = 0;
	let failure: { error: unknown } | undefined;

	// A writer's error is held until every writer beside it has settled: the
	// step must never return while a harness process is still live.
	const track = ({ settle }: { settle: () => Promise<void> }) => {
		const ticket = nextTicket;

		nextTicket += 1;
		running.set(
			ticket,
			(async () => {
				try {
					await settle();
				} catch (error) {
					failure = failure ?? { error };
				} finally {
					running.delete(ticket);
				}
			})(),
		);
	};

	const startEligible = () => {
		while (!aggregate.isParked() && running.size < testWriterConcurrency) {
			const group = takeEligible({ waiting, reservations });

			if (group === undefined) {
				break;
			}

			reservations.reserve({ group });
			track({
				settle: async () => {
					const result = await spawnWriter({ group }).finally(() => {
						reservations.release({ group });
					});

					await aggregate.collect({ result });
				},
			});
		}
	};

	if (warm) {
		reservations.reserve({ group: warm.group });
		track({
			settle: async () => {
				await warm.spawn.finally(() => {
					reservations.release({ group: warm.group });
				});

				await collectWarm();
			},
		});
	}

	startEligible();

	while (running.size > 0) {
		await Promise.race([...running.values()]);

		startEligible();
	}

	if (failure) {
		throw failure.error;
	}
};
