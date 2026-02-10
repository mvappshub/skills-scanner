# RC1 Sign-off

- Status note (2026-02-10): this report was produced before migration to Claude Code CLI runtime.
  Current Claude provider is `claude-code` (via local bridge + `claude -p --json-schema`) and no longer depends on `ANTHROPIC_API_KEY`.

- Date: 2026-02-10
- Tested commit: `c74d177`
- Repo under test: fresh clone at `c:\Users\marti\Downloads\skills-scanner-rc1-signoff-20260210-005511`

## Commands Executed

```powershell
git clone c:\Users\marti\Downloads\skills-scanner c:\Users\marti\Downloads\skills-scanner-rc1-signoff-20260210-005511
cd c:\Users\marti\Downloads\skills-scanner-rc1-signoff-20260210-005511
npm ci
npm run build

# Gemini dev smoke
$env:VITE_LLM_PROVIDER='gemini'
npx vite --host 127.0.0.1 --port 5181
# probe: GET http://127.0.0.1:5181 -> 200

# Claude bridge + dev smoke
$env:CLAUDE_BRIDGE_PORT='3794'
node claude-bridge/server.mjs
# probe: GET http://127.0.0.1:3794/health -> 200

$env:VITE_LLM_PROVIDER='claude-code'
$env:VITE_CLAUDE_BRIDGE_URL='http://127.0.0.1:3794'
npx vite --host 127.0.0.1 --port 5182
# probe: GET http://127.0.0.1:5182 -> 200

# Bridge selftest
$env:CLAUDE_BRIDGE_URL='http://127.0.0.1:3795'
npm run bridge:selftest
```

## Preconditions Found

- `VITE_GEMINI_API_KEY`: missing in local env.
- Consequence: full Gemini provider generation path cannot be signed off in this environment.

## DEMO Checklist (docs/DEMO.md)

| Step | Result | Notes |
|---|---|---|
| 1. Start app (Gemini default) | PASS | Dev server responds `200` on `http://127.0.0.1:5181`. |
| 2. Optional: start Claude Bridge | PASS | Bridge `/health` responds `200` with `{ok:true}`. |
| 3. Open scanner and load sample skills folder | FAIL | Not executed headless; requires browser UI interaction. |
| 4. Run analysis passes | FAIL | Blocked by missing real provider API key. |
| 5. Verify graph health | FAIL | Depends on step 4 analysis output. |
| 6. Generate architect plan | FAIL | Blocked by missing real provider API key. |
| 7. Assemble workflow and inspect gaps | FAIL | Blocked by steps 4/6. |
| 8. Track run state | FAIL | UI-only validation pending manual browser run. |
| 9. Export checklist + run JSON | FAIL | UI-only validation pending manual browser run. |
| 10. Resume from exported run | FAIL | UI-only validation pending manual browser run. |
| 11. Create draft for missing capabilities | FAIL | Depends on assembled workflow in UI. |
| 12. Quick bridge self-test | FAIL | With dummy key: `401 authentication_error invalid x-api-key` (expected). |

## Provider Verification

- Gemini startup path: PASS (dev server boot + UI served).
- Claude bridge startup path: PASS (`/health` online).
- Claude model call path: FAIL in this environment (no valid Anthropic key).
- Provider switch invalidation (`model_changed`): CODE PATH VERIFIED in `App.tsx` (`derivePendingReason` compares `providerId` and `modelId` and sets `model_changed`).

## Screenshot-worthy Outcomes (text description)

1. Bridge status indicator in Workflow Assembler:
   - In Claude mode, UI shows `Bridge online/offline`.
   - Offline guidance message explicitly says to run `npm run claude-bridge`.
2. One-click demo actions:
   - Buttons `Load demo prompt` and `Load demo + run demo pipeline` appear in the Workflow Architect section.
   - Prompt templates are visible as three quick actions.
3. Export/run safety and run-state UX:
   - Danger gate modal blocks export for `riskLevel=danger` until user confirms `I understand / Continue`.
   - Step-level run status (`todo/done/failed`) + notes are included in run JSON export/import flow.

## Sign-off Decision

- RC1 infrastructure and startup hardening: **PASS**.
- Full end-to-end RC1 UX/provider generation: **PENDING** (requires valid `VITE_GEMINI_API_KEY` + manual browser run).
