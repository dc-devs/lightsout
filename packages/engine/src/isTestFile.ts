/** Test files are exempt from duplication tiers (assertion literals are contract-pinning, not copy-paste) and from one-export-per-file. */
export const isTestFile = (path: string) => /(^|\/)(tests?|__tests__|__mocks__|e2e)\//.test(path) || /\.(test|spec)\./.test(path);
