/**
 * Classify a driver invocation by markers the invocation builders emit.
 * Fix re-invocations keep their role ('write-tests'/'refactor') and
 * additionally contain '# Verification failure'; a fix for verify-implement
 * classifies as 'fix'.
 */
export const roleOf = (prompt: string) => {
	if (prompt.includes('# Failing step')) {
		return 'supervisor';
	}

	if (prompt.includes('# Changed files to cover')) {
		return 'write-tests';
	}

	if (prompt.includes('# Changed files to review')) {
		return 'refactor';
	}

	if (prompt.includes('# Verification failure')) {
		return 'fix';
	}

	return 'implement';
};
