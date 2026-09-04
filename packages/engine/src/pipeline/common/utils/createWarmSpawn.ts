import type { WriterResult } from '#src/pipeline/common/types/WriterResult.ts';

interface Params<TGroup> {
	/** The assignment to warm on, or undefined when there is nothing to warm for. */
	group: TGroup | undefined;
	spawnWriter: ({ group, onFirstEvent }: { group: TGroup; onFirstEvent?: () => void }) => Promise<WriterResult<TGroup>>;
	aggregate: { collect: ({ result }: { result: WriterResult<TGroup> }) => Promise<void> };
}

interface WarmSpawn<TGroup> {
	/** The warm-up spawn itself, or undefined when none was made. */
	warm: Promise<WriterResult<TGroup>> | undefined;
	/** Fold the warm-up result in, once and only once. */
	collectWarm: () => Promise<void>;
	/** Wait until the batch behind the warm-up may spawn. */
	awaitGate: () => Promise<void>;
	isSettled: () => boolean;
}

/**
 * The warm-up spawn and the gate holding the rest behind it. The first
 * assignment goes out alone and the others wait until it emits its first stream
 * event — the moment its response begins is the moment the harness's prompt
 * cache holds the writers' shared system prompt, so the batch that follows reads
 * the cache instead of paying for it once per writer. The gate is raced against
 * the spawn settling, so one that dies or streams nothing (stub drivers) simply
 * falls back to unwarmed behavior. No group means nothing to warm for, and every
 * hook below turns into a no-op.
 *
 * @typeParam TGroup - the assignment each writer was given.
 */
export const createWarmSpawn = <TGroup>({ group, spawnWriter, aggregate }: Params<TGroup>): WarmSpawn<TGroup> => {
	let settled = false;
	let collected = false;
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const warm =
		group === undefined
			? undefined
			: spawnWriter({ group, onFirstEvent: release }).finally(() => {
					settled = true;
				});

	// Collected exactly once, wherever it resolves: before the batches when the
	// warm spawn settled first (a rate limit there must stop them), between
	// batches once it settles mid-run, or after the loop on the event path.
	const collectWarm = async () => {
		if (warm && !collected) {
			collected = true;

			await aggregate.collect({ result: await warm });
		}
	};

	const awaitGate = async () => {
		if (warm) {
			await Promise.race([
				gate,
				warm.then(
					() => undefined,
					() => undefined,
				),
			]);
		}
	};

	return { warm, collectWarm, awaitGate, isSettled: () => settled };
};
