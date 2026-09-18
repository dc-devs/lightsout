import { messageOf } from '#src/common/utils/messageOf.ts';
import { type LightsoutConfig, Permissions } from '#src/contracts/index.ts';
import type { DoctorCheck } from '#src/doctor/common/types/DoctorCheck.ts';
import { type Driver, getDriver } from '#src/drivers/index.ts';

/** The adapter file whose parse has to be re-captured when a harness renames its token fields. One entry per harness this work covers. */
const usageAdapters: Record<string, string> = {
	'claude-code': 'packages/engine/src/drivers/createClaudeCodeDriver.ts',
	omp: 'packages/engine/src/drivers/createPiDriver.ts',
	pi: 'packages/engine/src/drivers/createPiDriver.ts',
};

const holdsFiniteNumber = ({ value }: { value: unknown }) =>
	typeof value === 'object' && value !== null && Object.values(value).some((member) => typeof member === 'number' && Number.isFinite(member));

/**
 * Whether one raw harness event carries token counts as it streams.
 *
 * Deliberately generic — a `usage` member holding at least one finite number,
 * at any bounded depth — rather than a second copy of the adapter's own zod
 * schema. A copy would pass exactly when the adapter passes and would therefore
 * detect nothing, which is the entire failure this check exists to catch.
 */
const carriesStreamedUsage = ({ event, depth }: { event: unknown; depth: number }): boolean => {
	// Claude Code nests its counts two levels down (`message.usage`); nothing any
	// harness streams is deeper than this, and an unbounded walk would follow a
	// cyclic event for ever.
	const maxEventDepth = 6;

	if (depth > maxEventDepth || typeof event !== 'object' || event === null) {
		return false;
	}

	return Object.entries(event).some(
		([key, value]) => (key === 'usage' && holdsFiniteNumber({ value })) || carriesStreamedUsage({ event: value, depth: depth + 1 }),
	);
};

/**
 * The one throwaway agent call, and the two readings taken from it: the
 * normalized usage a settled call returns, and whether anything the stream
 * handed `onEvent` carried token counts on the way. They fail apart — a harness
 * can state a perfect terminal total and stream nothing — and a process killed
 * at its ceiling has only the streamed one to fall back on.
 *
 * A throw comes back as a value: a probe that spent the user's money and then
 * escaped as an error would be the worst of both.
 */
const probeHarnessUsage = async ({ cwd, harness, driver }: { cwd: string; harness: string; driver?: Driver }) => {
	// An agent call, not a `--version` probe: long enough for a one-word answer
	// on a cold harness, short enough that a hang does not hold the doctor.
	const timeoutMs = 120_000;
	let streamed = false;

	try {
		const result = await (driver ?? getDriver({ name: harness })).invoke({
			prompt: 'Reply with the single word: ok. Do not use any tools.',
			cwd,
			permissions: Permissions.ReadOnly,
			timeoutMs,
			onEvent: (event) => {
				streamed = streamed || carriesStreamedUsage({ event, depth: 0 });
			},
		});

		return { streamed, usage: result.usage };
	} catch (error) {
		return { error: messageOf({ error }) };
	}
};

type Probed = Awaited<ReturnType<typeof probeHarnessUsage>>;

/**
 * What the two readings mean, worst first. Both present is the only pass:
 * settled-only still leaves a timed-out spawn with nothing to recover, and
 * neither reads exactly like a call that spent nothing, which is why the fix
 * names the adapter file rather than the symptom.
 */
const verdictOf = ({ harness, probed }: { harness: string; probed: Probed }): DoctorCheck => {
	const adapter = usageAdapters[harness] ?? `the ${harness} driver`;
	let verdict: Omit<DoctorCheck, 'id'>;

	if ('error' in probed) {
		verdict = {
			status: 'fail',
			detail: `the ${harness} probe call did not finish: ${probed.error}`,
			fix: `run \`${harness === 'claude-code' ? 'claude' : harness} --version\` and confirm the harness is installed and logged in, then run the probe again`,
		};
	} else if (probed.usage === undefined) {
		verdict = {
			status: 'fail',
			detail: `${harness} reported no tokens at all — a settled call came back with no usage`,
			fix: `${harness} has most likely renamed its token fields — re-capture its real output and update the parse in ${adapter}`,
		};
	} else if (!probed.streamed) {
		verdict = {
			status: 'warn',
			detail: `${harness} reported ${probed.usage.inputTokens} in / ${probed.usage.outputTokens} out when the call settled, but streamed no token counts on the way`,
			fix: `a process killed at its time limit never settles, so it would recover nothing — re-capture ${harness}'s real output and update the streamed-usage parse in ${adapter}`,
		};
	} else {
		verdict = {
			status: 'pass',
			detail: `${harness} reported ${probed.usage.inputTokens} in / ${probed.usage.outputTokens} out when the call settled, and streamed token counts as it ran`,
		};
	}

	return { id: 'harness-usage', ...verdict };
};

interface Params {
	cwd: string;
	config: LightsoutConfig;
	/** Test seam for the throwaway agent call — defaults to the driver the config names. */
	driver?: Driver;
}

/**
 * Opt-in: spend one real agent call on the configured harness and answer
 * whether that harness's token fields still reach the engine.
 *
 * Every figure the activity record holds comes from one adapter's parse of one
 * harness's own output, pinned in the suite against output captured by hand and
 * committed. That capture goes stale the moment the harness ships a new format,
 * and the failure is silent — plans keep running and the token columns simply
 * go blank. This is the ten-second check that turns that into a stated one.
 *
 * It spawns exactly once, against the global `harness` only: each spawn is real
 * money on the user's own subscription, and one call answers the format
 * question for the adapter under test. Codex is never spawned — its driver
 * reads no usage by design, so probing it would spend money to rediscover a
 * known answer.
 */
export const checkHarnessUsage = async ({ cwd, config, driver }: Params): Promise<DoctorCheck> => {
	const harness = config.harness ?? 'claude-code';

	if (harness === 'codex') {
		return {
			id: 'harness-usage',
			status: 'note',
			detail: 'codex reads no usage by design, so it is not probed — codex plans report no tokens',
		};
	}

	return verdictOf({ harness, probed: await probeHarnessUsage({ cwd, harness, driver }) });
};
