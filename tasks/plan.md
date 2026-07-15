# Plan: knowledge-base-gui

## Tasks

### T1: Install dependencies
**Status:** pending
**Acceptance criteria:**
- `express`, `marked` in `dependencies`
- `@types/express`, `supertest`, `@types/supertest` in `devDependencies`
- `npm install` succeeds, TypeScript can resolve the types
**Dependencies:** none

---

### T2: GUI DB layer — listFeatures
**Status:** pending
**Acceptance criteria:**
- `src/gui/db.ts` exports `listFeatures(db, workspace): Feature[]`
- Returns features sorted by name for a given workspace
- Returns empty array for unknown workspace
- `tests/gui/db.test.ts` covers both cases
**Dependencies:** T1

---

### T3: HTML render helpers
**Status:** pending
**Acceptance criteria:**
- `src/gui/render.ts` exports functions:
  - `layout(title, body)` → full HTML page string with minimal CSS
  - `renderWorkspaceList(workspaces)` → HTML for workspace list
  - `renderFeatureList(workspace, features)` → HTML for feature list
  - `renderContentList(workspace, feature, contents)` → HTML for content list
  - `renderContent(content)` → HTML for single content with Markdown body
  - `renderSearchResults(query, results)` → HTML for search results
- Each function returns a valid HTML string (no async)
**Dependencies:** T1

---

### T4: Express server (createApp)
**Status:** pending
**Acceptance criteria:**
- `src/gui/server.ts` exports `createApp(db: DatabaseSync): Express`
- Routes:
  - `GET /` → workspace list page (200)
  - `GET /ws/:workspace` → feature list page (200) or 404 if workspace unknown
  - `GET /ws/:workspace/:feature` → content list page (200) or 404 if feature unknown
  - `GET /ws/:workspace/:feature/:id` → content page with Markdown (200) or 404 if not found
  - `GET /search?q=` → search results (200); `q` required, else redirect to `/`
- All pages use `layout()` from render.ts
- CSS is minimal but readable (monospace font, max-width, basic nav)
**Dependencies:** T2, T3

---

### T5: Server route tests
**Status:** pending
**Acceptance criteria:**
- `tests/gui/server.test.ts` uses `supertest` against `createApp(testDb)`
- Tests cover: workspace list, feature list, content list, single content (verifies Markdown is rendered as HTML), search, 404 cases
**Dependencies:** T4

---

### T6: CLI entry point
**Status:** pending
**Acceptance criteria:**
- `src/bin/gui.ts` reads `PORT` env (default `3000`), opens DB, calls `createApp(db).listen(port)`
- Logs `Listening on http://localhost:PORT` on start
- Exits with error message if `DB_PATH` not set
**Dependencies:** T4

---

### T7: Build wiring
**Status:** pending
**Acceptance criteria:**
- `package.json` `bin` includes `"knowledge-base-gui": "dist/bin/gui.js"`
- `npm run build` compiles `src/bin/gui.ts` without errors
- `npm run lint` passes
**Dependencies:** T6
