# Repository Guidelines

## Project Structure & Module Organization
- `src/` holds the React + TypeScript frontend (entry `src/main.tsx`), with UI in `src/components`, state in `src/stores`, utilities in `src/utils`, and styles in `src/index.css`.
- `server/` contains the Node/Express backend as ESM `.mjs` modules (embedding, topology, storage, and API wiring).
- `test/` includes automated tests and benchmark scripts (mix of `*.js`, `*.mjs`, `*.ts`).
- `data/` and `test-data/` store fixtures and sample inputs.
- `doc/` contains detailed project notes and quickstarts.
- Root config lives in `vite.config.ts`, `tsconfig.json`, `eslint.config.js`, and `tailwind.config.js`.

## Build, Test, and Development Commands
- `npm run server`: start backend (`server/index.mjs`) and Vite dev server concurrently.
- `npm run server:backend`: backend only on `PORT` (default 8787).
- `npm run build`: typecheck + Vite production build.
- `npm run preview`: serve the production build locally.
- `npm run lint`: run ESLint for TS/React rules.
- `npm run check`: typecheck only (`tsc -b --noEmit`).
- `npm run test`: Vitest watch mode; `npm run test:run` for a single run; `npm run test:ui` for UI runner.
- `npm run test:benchmark`: run `test/benchmark_precision.mjs`.

## Coding Style & Naming Conventions
- TypeScript + React with Vite; 2-space indentation, single quotes, and no semicolons (see `src/main.tsx`).
- Use the `@/` path alias for `src/*` imports.
- Components are `PascalCase` (e.g., `src/components/FooBar.tsx`); backend modules are lowercase or kebab-case `.mjs` files.
- Run `npm run lint` before committing.

## Testing Guidelines
- Keep tests and scripts in `test/` using existing naming patterns (`*-test.mjs`, `*Test.js`, `*.ts`).
- Prefer Vitest for unit/integration tests; keep long-running benchmarks separated and run via `npm run test:benchmark`.

## Commit & Pull Request Guidelines
- Recent commits mix short verbs (`update`, `clean code`) and conventional prefixes (`feat:`, `fix:`, `docs:`). Prefer conventional prefixes when adding new work, and keep the subject brief.
- PRs should include a concise summary, key commands run (e.g., `npm run test:run`), and screenshots for UI changes. Link related issues when applicable.

## Configuration & Secrets
- Backend reads `PORT`, `AZURE_VISION_ENDPOINT`, `AZURE_VISION_KEY`, `SILICONFLOW_API_KEY` (or `VITE_SILICONFLOW_API_KEY`). Do not commit secrets; document local setup changes in your PR.
