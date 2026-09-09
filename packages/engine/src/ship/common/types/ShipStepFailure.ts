/**
 * Why a command-backed ship step did not produce what the sequence needed.
 *
 * The stderr of the run that failed, carried back as a value rather than
 * dropped — a blocked result whose detail says only "git could not push" sends
 * the reader back to a terminal to find out why, which is the one thing the
 * result file exists to avoid. Empty when the step failed without the process
 * saying anything, and the caller then leaves its sentence alone rather than
 * appending a bare colon.
 */
export interface ShipStepFailure {
	stderr: string;
	/**
	 * Set only by `mergePullRequest`, and only when the forge's own structured
	 * state proved a newer base is the whole problem. Unset means the failure is
	 * final — an absent flag can never be read as "worth another attempt".
	 */
	staleBase?: boolean;
}
