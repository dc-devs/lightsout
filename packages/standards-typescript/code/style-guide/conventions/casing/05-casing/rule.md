---
summary: "a declaration whose name is not in the casing its kind takes"
checked: true
severity: advisory
---

| Item              | Convention                            | Example                                   |
| ----------------- | ------------------------------------- | ----------------------------------------- |
| Variables         | camelCase                             | `userName`, `isActive`                    |
| Functions/Methods | camelCase                             | `getUserName()`, `calculateTotal()`       |
| Classes           | PascalCase                            | `UserService`, `ApiClient`                |
| Interfaces        | PascalCase                            | `UserProfile`, `ApiResponse`              |
| Types             | PascalCase                            | `UserId`, `RequestOptions`                |
| Value constants   | camelCase                             | `maxRetries`, `emailRegex`                |
| Named constants   | PascalCase                            | `Action`, `LogLevel` (see [named-constants.md](../patterns/named-constants.md)) |
| File names        | See [file-naming.md](./file-naming.md) | —                                         |
