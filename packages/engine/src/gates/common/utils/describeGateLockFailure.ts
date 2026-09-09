interface Params {
	/** The filesystem error's own message, so the reader sees the code and the path the platform reported. */
	failure: string;
}

/**
 * The one sentence a gate run that never started because the shared reservation
 * could not be written is reported with.
 *
 * Its own sentence rather than a cause on the timeout builder, because the two
 * describe different events and the whole value of either is that the reader
 * knows at once which one happened: no run is holding this machine, so telling
 * anyone to sit and hope for one would send them after a holder that does not
 * exist.
 */
export const describeGateLockFailure = ({ failure }: Params): string =>
	`gates never started: the shared gate reservation in this repository's primary checkout could not be created or read (${failure}). No gate command executed, so nothing here is evidence about the code. Fix the permissions on that .lightsout folder, or free the disk, and start the run again.`;
