<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1ZVlt00iaBTlGD1WfCa8SEufQM1CL-O_F

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set provider in [.env.local](.env.local):
   - `VITE_LLM_PROVIDER=gemini` (default) or `VITE_LLM_PROVIDER=claude-code`
3. For Gemini mode, set `VITE_GEMINI_API_KEY` in `.env.local`
4. Run the app:
   `npm run dev`

## Claude Bridge Mode (local)

1. Install Claude Code CLI and finish login once:
   - install CLI so `claude --help` works
   - run `claude` and complete login
2. Set server env vars (optional):
   - `CLAUDE_BRIDGE_PORT=3789`
   - `CLAUDE_CLI_BIN=claude` (if binary name/path differs)
2. Start bridge:
   - `npm run claude-bridge`
3. In frontend `.env.local` set:
   - `VITE_LLM_PROVIDER=claude-code`
   - `VITE_CLAUDE_BRIDGE_URL=http://localhost:3789`

Bridge healthcheck:
- `GET http://localhost:3789/health` → includes `ok`, `cliInstalled`, `loggedIn`

### Bash / zsh quickstart

```bash
npm run claude-bridge

# new terminal
export VITE_LLM_PROVIDER=claude-code
export VITE_CLAUDE_BRIDGE_URL=http://localhost:3789
npm run dev
```

### PowerShell quickstart

```powershell
npm run claude-bridge

# new terminal
$env:VITE_LLM_PROVIDER='claude-code'
$env:VITE_CLAUDE_BRIDGE_URL='http://localhost:3789'
npm run dev
```

### Developer shortcuts

- `npm run dev:gemini`
- `npm run dev:claude`
- `npm run bridge:selftest`
  - requires running bridge with Claude CLI installed and logged in

## RC1 Demo Path

- Follow `docs/DEMO.md` for the end-to-end golden path:
  scan -> graph -> architect -> assemble -> missing tags -> export/import run -> draft generation.
- Quality metrics are documented in `docs/QUALITY.md` and are logged in browser console with `[quality]`.
