# Classes

## When to Use a Class — The Bright Line

Default to functions. Create a class **if and only if at least one** of these is true:

| # | Criterion | Example |
|---|-----------|---------|
| a | **Mutable state persists across method calls** | `RateLimiter` (remaining tokens), a cache, a connection pool |
| b | **3+ operations share injected config/dependencies** | `HttpClient` (baseUrl, retry policy, credentials injected once, used by every method) |
| c | **Multiple implementations of a shared interface** | `FileSource` / `S3Source` behind one `RecordSource` contract |
| d | **The framework requires it** | NestJS services, resolvers, guards (DI container needs classes) |

If none apply: **functions in a module.** A per-invocation operation is a function no matter how large or important — nothing persists, so there is nothing for a class to hold.

Fast gut-check: *is "how many of these exist right now?" a meaningful question?* Two `HttpClient`s pointed at different APIs — meaningful → class. Two `formatDate`s — nonsensical → function.

### Banned: Static-Only Classes

A class with only static methods is a module wearing a costume — it adds `ClassName.` prefixes and inheritance hazards while binding no state. Use module functions instead.

❌ BAD: Static-only class as a namespace

```typescript
export class DateUtils {
	static formatDate() { /* ... */ }
	static parseDate() { /* ... */ }
}
```

✅ GOOD: Module functions (each exported function in its own file)

**`formatDate.ts`**, **`parseDate.ts`**

### Banned: One-Method Stateless Classes

`class ReportGenerator { execute() }` with a meaningless constructor is a function with a hat on. Write the function.

## Syntax & Style

- In the constructor, pass in object as argument, and destructure args
    - This allows class args to be flexible, allowing us to easily add/remove args without being confined to chronological ordered arguments
- Create an interface called `ConstructorParams` defining the constructor options
- Export the class on the line it is defined as a named export

### Instance Method Parameters

- For class instance methods, use inline type definitions rather than separate interfaces
- This keeps the method signature self-contained and avoids creating unnecessary interface files

### Return Types on Methods

Public methods of an exported class are exported surface — declare their return types (see [typescript.md](../typescript/return-types.md#return-types--explicit-on-exports-inferred-internally)). `private` methods infer, like any internal. The interface-pinned exception applies: a method implementing a declared interface is already contracted and need not restate the type.

✅ GOOD: Inline type for class instance method

```typescript
async getConsoleLogSummaries({
  issueId,
}: {
  issueId: number;
}) {
  // Method code here
}
```

❌ BAD: Separate interface for class instance method

```typescript
interface GetConsoleLogSummariesParams {
  issueId: number;
}

async getConsoleLogSummaries({
  issueId,
}: GetConsoleLogSummariesParams) {
  // Method code here
}
```

## Class Syntax – Example

**`Person.ts`**

```typescript
interface ConstructorParams {
	name: string;
	age: number;
	email?: string;
	isActive?: boolean;
}

export class Person {
	private readonly name: string;
	private readonly age: number;
	private readonly email?: string;
	private isActive: boolean;

	constructor({ name, age, email, isActive = true }: ConstructorParams) {
		this.name = name;
		this.age = age;
		this.email = email;
		this.isActive = isActive;
	}

	greet(): string {
		return `Hello, my name is ${this.name} and I am ${this.age} years old.`;
	}

	getContactInfo(): { name: string; age: number; email?: string } {
		return {
			name: this.name,
			age: this.age,
			email: this.email,
		};
	}

	setActiveStatus({ status }: { status: boolean }): void {
		this.isActive = status;
	}

	getActiveStatus(): boolean {
		return this.isActive;
	}
}
```

## File vs Folder — The Graduation Rule

Classes follow the same [graduation rule](../../../fdrop:code:architecture/references/architecture-decisions.md#modules--the-graduation-rule) as everything else:

- **A class starts as a single file** — `RateLimiter.ts` with its test beside it. Small class, no companions, compiler-enforced privacy for free. Non-exported helper functions may co-locate in the class file.
- **A class graduates to a folder** — `HttpClient/` — when it needs private companions: bundled utils, interfaces, or constants that exist only to serve it.

Do NOT create a folder for a class that has no companions — that is ceremony, not structure.

### Folder Structure (when graduated)

- Class folder name matches the class name
- Companion items go under a `common/` folder, organized by category (`utils/`, `types/`, `constants/`), each with a barrel `index.ts`
- The class folder's `index.ts` exports the class — it is the module's public API, and the boundary rule applies: outsiders import only from it

### Folder Structure – Example

```
HttpClient/
├─ common/
│  ├─ utils/
│  │  ├─ index.ts
│  │  ├─ buildRetryDelays.ts
│  │  └─ buildHeaders.ts
│  ├─ types/
│  │  ├─ index.ts
│  │  └─ RequestOptions.ts
│  ├─ constants/
│  │  ├─ index.ts
│  │  └─ RetryStrategy.ts
├─ HttpClient.ts
├─ HttpClient.unit.test.ts
├─ index.ts
```

### Interfaces and Types – Same Folder

See [type-placement.md](../structure/type-placement.md#interfaces-vs-types--same-folder-pick-by-fit) for the full rule and examples. In short: both `export interface` and `export type` declarations live in `types/`; the keyword is a per-declaration choice, not a folder decision.

### Example – Class Barrel File

**`HttpClient/index.ts`**

```typescript
export { HttpClient } from '@path/to/HttpClient/HttpClient';
```

## Advanced Patterns

- Prefer extracting logic into small functions over adding instance methods:
    - **Before graduation** (single-file class): non-exported helper functions co-located in the class file
    - **After graduation** (class folder): files under the class folder's `common/utils/`
- The benefits of this approach:
    - Creates more maintainable and readable class files
    - Keeps the class surface limited to behavior that genuinely needs its state
    - Logic is covered through the class's public API; a util only gets direct tests if it is promoted out of the class module for reuse
