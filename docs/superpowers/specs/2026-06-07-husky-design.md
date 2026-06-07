# Husky Git Hooks — Design Spec

**Date:** 2026-06-07  
**Status:** Approved

---

## Mục tiêu

Thiết lập Git hooks tự động đảm bảo code quality và commit message convention trước khi commit được tạo.

---

## Hooks

| Hook | Tool | Hành động |
|---|---|---|
| `pre-commit` | lint-staged + tsc | Biome check+fix staged files → typecheck toàn bộ |
| `commit-msg` | commitlint | Validate theo Conventional Commits |

---

## Packages

```
husky                          — quản lý git hooks
lint-staged                    — chạy linter chỉ trên staged files
@commitlint/cli                — validate commit message
@commitlint/config-conventional — Conventional Commits ruleset
```

Tất cả là `devDependencies`.

---

## File output

```
.husky/
├── pre-commit     — lint-staged + typecheck
└── commit-msg     — commitlint
commitlint.config.js
package.json       (modified: thêm prepare, lint-staged config, devDeps)
```

---

## Chi tiết từng file

### `.husky/pre-commit`

```sh
pnpm lint-staged
pnpm typecheck
```

### `.husky/commit-msg`

```sh
pnpm commitlint --edit "$1"
```

### `commitlint.config.js`

```js
export default { extends: ['@commitlint/config-conventional'] }
```

Dùng ESM (`export default`) vì `package.json` có `"type": "module"` hoặc project dùng `.js` ESM — nếu CJS thì dùng `module.exports`.

### `package.json` — thêm vào

```json
"prepare": "husky",
"lint-staged": {
  "*.{ts,js,json}": ["biome check --write --no-errors-on-unmatched"]
}
```

---

## Conventional Commits — types hợp lệ

`feat` · `fix` · `docs` · `style` · `refactor` · `perf` · `test` · `build` · `ci` · `chore` · `revert`

Scope optional. Breaking change: thêm `!` sau type (`feat!:`) hoặc footer `BREAKING CHANGE:`.

---

## Quyết định thiết kế

- **`biome check --write`** thay vì `biome lint` — fix tự động luôn, không để developer phải fix thủ công.
- **`--no-errors-on-unmatched`** — tránh lint-staged fail khi không có file match pattern.
- **typecheck trong pre-commit** — chạy toàn bộ `tsc`, không chỉ staged files, vì type error ở file không staged vẫn cần phát hiện sớm.
- **`prepare` script** — chạy `husky` tự động sau `pnpm install`, đảm bảo hooks được cài trên mọi máy developer.
