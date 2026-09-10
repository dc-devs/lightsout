// `getWorktreeRecordPath` stays off this barrel, for the reason
// `queue/branchState/index.ts` gives about `getBranchStatePath`: the record's
// location is this module's business, and a caller that can build the path can
// write the file without the contract the writer applies.
export { deleteWorktreeRecord } from '#src/worktree/records/deleteWorktreeRecord.ts';
export { readWorktreeRecord } from '#src/worktree/records/readWorktreeRecord.ts';
export { writeWorktreeRecord } from '#src/worktree/records/writeWorktreeRecord.ts';
