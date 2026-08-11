// Two same-typed slots in a row: `copyFile(dest, src)` compiles just as happily
// as the intended order, and no call site says which is which.
export const copyFile = (sourcePath: string, destPath: string, overwrite = false): string =>
	`${sourcePath} -> ${destPath}${overwrite ? ' (overwrite)' : ''}`;
