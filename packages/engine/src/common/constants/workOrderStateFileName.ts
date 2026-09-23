/**
 * The one spelling of a work order's record file name.
 *
 * It sits here rather than inside the `workOrder` module because `ship` and
 * `worktree` both need to find a work order's folder from a branch, and both
 * are already imported BY that module — a look-up that imported `workOrder`
 * would close a module cycle. `workOrderFileNames` reads its `record` member
 * from here, so the name is still written exactly once.
 */
export const workOrderStateFileName = 'state.json';
