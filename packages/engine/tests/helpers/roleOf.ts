/**
 * Classify a driver invocation by markers the invocation builders emit.
 * Fix re-invocations keep their role ('write-tests'/'refactor') and
 * additionally contain '# Verification failure'; a fix for verify-implement
 * classifies as 'fix'.
 */
export const roleOf = (prompt: string) => {
	// Checked first: the commit-message call carries the staged diff, and a diff
	// can hold any other role's heading as a line it changed.
	if (prompt.includes('# Staged change')) {
		return 'commit-message';
	}

	// Checked before the working roles: the standards reviewer runs alongside the refactor gate and
	// the refactor batches, so a stub that mistook it for the role it runs beside
	// would answer the wrong agent.
	if (prompt.includes('# Files in scope for the standards review')) {
		return 'standards-review';
	}

	if (prompt.includes('# Failing step')) {
		return 'supervisor';
	}

	if (prompt.includes('# Test subjects — write tests through these public surfaces')) {
		return 'write-tests';
	}

	// Two headings, one role: the refactor executor names its work-list for who
	// invoked it — a feature's changed files, or the files a standalone run's
	// findings sit in — and both are the same agent doing the same job.
	if (prompt.includes('# Changed files to review') || prompt.includes('# Files the findings name')) {
		return 'refactor';
	}

	if (prompt.includes('# Verification failure')) {
		return 'fix';
	}

	return 'implement';
};
