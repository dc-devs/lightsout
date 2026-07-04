# Classes

## When to Use a Class — The Bright Line

Default to functions. Create a class **if and only if at least one** of these is true:

| # | Criterion | Example |
|---|-----------|---------|
| a | **Mutable state persists across method calls** | `RateLimiter` (remaining tokens), a cache, a connection pool |
| b | **3+ operations share injected config/dependencies** | `HttpClient` (baseUrl, retries, credentials injected once, used by every method) |
| c | **Multiple implementations of a shared interface** | `FileSource` / `S3Source` behind one `RecordSource` contract |
| d | **The framework requires it** | NestJS services, resolvers, guards (DI needs classes) |

If none apply: **functions in a module.** Gut-check: *is "how many of these exist right now?" a meaningful question?* Two `HttpClient`s pointed at different APIs — meaningful → class. Two `formatDate`s — nonsensical → function.

**Banned:**

- **Static-only classes** — a module wearing a costume; it adds `ClassName.` prefixes and binds no state. Use module functions (each exported function in its own file).
- **One-method stateless classes** — `class ReportGenerator { execute() }` is a function with a hat on. Write the function.

## Syntax & Style

- Constructor takes an object argument, destructured; declare a `ConstructorParams` interface for it.
- **Instance methods** use inline object types for their params — not separate interfaces (keeps the signature self-contained, avoids interface-file sprawl).
- Public methods of an exported class declare return types; `private` methods infer (see [return-types.md](../typescript/return-types.md)). Interface-pinned methods need not restate the type.
- Export the class as a named export on the line it is defined.

```typescript
interface ConstructorParams {
	name: string;
	isActive?: boolean;
}

export class Person {
	private readonly name: string;
	private isActive: boolean;

	constructor({ name, isActive = true }: ConstructorParams) {
		this.name = name;
		this.isActive = isActive;
	}

	greet(): string {
		return `Hello, my name is ${this.name}.`;
	}

	setActiveStatus({ status }: { status: boolean }): void {
		this.isActive = status;
	}
}
```

## File vs Folder — The Graduation Rule

Classes follow the same graduation rule as everything else (see [architecture-decisions.md](../../architecture/architecture-decisions.md#modules--the-graduation-rule)):

- **A class starts as a single file** — `RateLimiter.ts` with its test beside it; non-exported helpers may co-locate.
- **A class graduates to a folder** — `HttpClient/` — only when it needs private companions (bundled utils, types, or constants that serve only it). Companions live under `common/` by category (`utils/`, `types/`, `constants/`), each with a barrel; the class folder's `index.ts` exports the class and the boundary rule applies.
- Do NOT create a folder for a class with no companions — that is ceremony, not structure.

## Keep the Class Surface Small

Prefer extracting logic into functions over adding instance methods: before graduation, non-exported helpers in the class file; after, files under the folder's `common/utils/`. The class surface stays limited to behavior that genuinely needs its state; logic is covered through the class's public API.
