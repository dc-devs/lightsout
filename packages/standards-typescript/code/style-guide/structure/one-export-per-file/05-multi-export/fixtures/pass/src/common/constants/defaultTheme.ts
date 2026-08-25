// Exception 5: a type and the single value typed by it share a file, filed
// under the value's name.
export interface Theme {
	name: string;
}

export const defaultTheme: Theme = { name: 'dark' };
