# Golden Path Demo (RC1)

This is the shortest end-to-end walkthrough for the user journey:
scan -> graph -> architect plan -> assemble -> missing -> export/draft.

## 1) Start app (Gemini default)

```bash
npm install
npm run dev:gemini
```

If you want Claude Bridge mode, see step 2 and then run `npm run dev:claude`.

## 2) Optional: start Claude Bridge

```bash
# make sure `claude --help` works and you have completed login via `claude`
npm run claude-bridge
```

Bridge check:

```bash
curl http://localhost:3789/health
```

## 3) Open scanner and load a sample skills folder

Use `Upload` and pick a folder with skills (`SKILL.md` files).  
The app will create a dataset and show cache coverage.

## 4) Run analysis passes

1. Run `Pass 1` for pending skills.
2. Run `Pass 2` for deeper semantics where needed.
3. Confirm at least part of the library is `semanticsStatus=ok`.

## 5) Verify graph health

Go to Dashboard / Workflow tab and confirm graph is available:
- non-zero analyzed skills
- edges/chains visible (or fallback tag-only mode when graph is sparse)

## 6) Generate architect plan

In Workflow Assembler:
1. Fill workflow description.
2. Click `Generate Plan`.
3. Review normalization warnings (mapped/dropped tags).

## 7) Assemble workflow and inspect gaps

1. Click `Assemble`.
2. Review selected skills per step.
3. Check `missing capabilities` per step and global missing tags.

## 8) Track run state (resume-ready)

Per step:
- set status `todo | done | failed`
- add optional note

This state is included in run export.

## 9) Export checklist + run JSON

Use:
- `Export Markdown checklist`
- `Export Workflow Run JSON`

If selected skills include `riskLevel=danger`, export requires explicit confirm (`I understand / Continue`).

## 10) Resume from exported run

Use `Import run JSON` to restore:
- workflow plan
- locked skill selections by step
- run step status + notes

You can continue without regenerating the plan.

## 11) Create draft for missing capabilities

For a missing tag:
- click `Generate SKILL.md`
- preview and download SKILL.md or ZIP draft scaffold

## 12) Quick bridge self-test (optional)

```bash
npm run bridge:selftest
```

Requires running bridge on `http://localhost:3789` with Claude CLI installed and logged in.
