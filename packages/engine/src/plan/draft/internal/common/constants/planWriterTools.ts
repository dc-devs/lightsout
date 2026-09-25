/**
 * The built-in tool names a focused plan-writer spawn is restricted to.
 *
 * These are the harness's own tool names, not an engine vocabulary. Claude Code
 * is the only registered harness that can express a built-in allowlist today, so
 * the list is spelled in its names; a second harness gaining the control maps
 * them in its own arg builder rather than this file growing a per-harness table.
 *
 * The set is exhaustive of what the focused role prompt tells a writer to do —
 * read and search source, write and edit the plan file, and run the granted check
 * commands — and deliberately omits delegation, workflow, web and notebook
 * tooling, which the focused environment excludes.
 */
export const planWriterTools: string[] = ['Bash', 'Edit', 'Glob', 'Grep', 'Read', 'Write'];
