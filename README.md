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
   - `VITE_LLM_PROVIDER=gemini` (default) or `VITE_LLM_PROVIDER=claude-bridge`
3. For Gemini mode, set `VITE_GEMINI_API_KEY` in `.env.local`
4. Run the app:
   `npm run dev`

## Claude Bridge Mode (local)

1. Set server env vars (shell env or `.env`):
   - `ANTHROPIC_API_KEY=<your_key>` (required)
   - `CLAUDE_BRIDGE_PORT=3789` (optional)
2. Start bridge:
   - `npm run claude-bridge`
3. In frontend `.env.local` set:
   - `VITE_LLM_PROVIDER=claude-bridge`
   - `VITE_CLAUDE_BRIDGE_URL=http://localhost:3789`

Bridge healthcheck:
- `GET http://localhost:3789/health` → `{ "ok": true }`

### Bash / zsh quickstart

```bash
export ANTHROPIC_API_KEY=your_key_here
npm run claude-bridge

# new terminal
export VITE_LLM_PROVIDER=claude-bridge
export VITE_CLAUDE_BRIDGE_URL=http://localhost:3789
npm run dev
```

### PowerShell quickstart

```powershell
$env:ANTHROPIC_API_KEY='your_key_here'
npm run claude-bridge

# new terminal
$env:VITE_LLM_PROVIDER='claude-bridge'
$env:VITE_CLAUDE_BRIDGE_URL='http://localhost:3789'
npm run dev
```

### Developer shortcuts

- `npm run dev:gemini`
- `npm run dev:claude`
- `npm run bridge:selftest`
  - requires running bridge with valid `ANTHROPIC_API_KEY`

## RC1 Demo Path

- Follow `docs/DEMO.md` for the end-to-end golden path:
  scan -> graph -> architect -> assemble -> missing tags -> export/import run -> draft generation.
- Quality metrics are documented in `docs/QUALITY.md` and are logged in browser console with `[quality]`.
