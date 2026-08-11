interface Params<Item> {
	items: Item[];
	matches: (item: Item) => boolean;
}

// A generic signature restated as a return type: the annotation says nothing the
// type parameter did not already say, and it is the harder of the two to read.
export const pickFirstMatch = <Item>({ items, matches }: Params<Item>): Item | undefined => items.find((item) => matches(item));
