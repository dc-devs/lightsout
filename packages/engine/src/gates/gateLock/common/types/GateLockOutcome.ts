/**
 * How a gate run's attempt on the shared reservation ended: it held the machine
 * for the whole run, or it never took it and says why.
 *
 * The two members are inline rather than named, following `SettleOutcome`:
 * nothing narrows by naming one — every caller narrows with
 * `'coordination' in outcome` — so a name for each would be an export with no
 * reader.
 */
export type GateLockOutcome<Result> =
	| {
			/** What the gate run answered, having held the machine for the whole of it. */
			held: Result;
	  }
	| {
			/** Why the machine was never taken — the sentence a caller reports instead of a red gate. */
			coordination: string;
	  };
