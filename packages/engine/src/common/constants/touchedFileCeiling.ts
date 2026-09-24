/**
 * How many source files one plan or phase may touch before the structural lint
 * refuses it.
 *
 * Touched means every source file the plan names under any file heading —
 * created, modified or moved. The number is fixed between the largest phases
 * measured to finish in one implementing run (62 files) and the smallest that
 * did not (77). It sits above the advisory executor-file-limit default, and
 * neither that config key nor a plan's `## File Budget` raises it, because an
 * unbounded budget is what let the 77-file phase through. The one exemption is
 * a rename-only plan or phase: its size is not what makes it hard.
 */
export const touchedFileCeiling = 70;
