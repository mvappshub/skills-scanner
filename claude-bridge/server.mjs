import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import os from 'os';
import path from 'path';
import { readFile } from 'fs/promises';
import { spawn } from 'child_process';

dotenv.config();

const PORT = Number(process.env.CLAUDE_BRIDGE_PORT || 3789);
const REQUEST_TIMEOUT_MS = Number(process.env.CLAUDE_BRIDGE_TIMEOUT_MS || 60000);
const CLAUDE_CLI_BIN = process.env.CLAUDE_CLI_BIN || 'claude';
const allowedOrigins = (process.env.CLAUDE_BRIDGE_ALLOWED_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);

const app = express();

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error('Origin not allowed by CLAUDE_BRIDGE_ALLOWED_ORIGINS.'));
    },
  }),
);
app.use(express.json({ limit: '1mb' }));

class BridgeError extends Error {
  constructor(message, code, statusCode = 500) {
    super(message);
    this.name = 'BridgeError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function assertGeneratePayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BridgeError('Body must be a JSON object.', 'INVALID_REQUEST', 400);
  }

  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  const schema = body.schema;
  const modelId = typeof body.modelId === 'string' ? body.modelId.trim() : undefined;

  if (!prompt) {
    throw new BridgeError('Missing required field: prompt.', 'INVALID_REQUEST', 400);
  }

  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new BridgeError('Missing required field: schema (JSON object).', 'INVALID_REQUEST', 400);
  }

  return { prompt, schema, modelId: modelId || undefined };
}

function extractFirstJsonObject(text) {
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }

    if (char === '}') {
      if (depth > 0) {
        depth -= 1;
        if (depth === 0 && start >= 0) {
          return text.slice(start, index + 1);
        }
      }
    }
  }

  return null;
}

function parseJsonObjectFromText(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // Try object substring fallback below.
  }

  const candidate = extractFirstJsonObject(trimmed);
  if (!candidate) return null;

  try {
    const parsed = JSON.parse(candidate);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
}

function isNotLoggedInOutput(outputText) {
  const lower = outputText.toLowerCase();
  return (
    lower.includes('not authenticated') ||
    lower.includes('authentication required') ||
    lower.includes('please log in') ||
    lower.includes('please login') ||
    lower.includes('run claude') ||
    lower.includes('setup-token') ||
    lower.includes('oauth')
  );
}

async function runCommand(command, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
    });

    let stdout = '';
    let stderr = '';
    let finished = false;
    const timeoutHandle = setTimeout(() => {
      if (finished) return;
      finished = true;
      child.kill();
      reject(new BridgeError(`claude CLI request timed out after ${timeoutMs}ms`, 'CLI_TIMEOUT', 504));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeoutHandle);

      if (error && error.code === 'ENOENT') {
        reject(new BridgeError('Install Claude Code CLI (`claude`) and try again.', 'CLI_MISSING', 503));
        return;
      }

      reject(new BridgeError(error instanceof Error ? error.message : 'Failed to start claude CLI.', 'CLI_START_FAILED', 500));
    });

    child.on('close', (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeoutHandle);

      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const combined = `${stderr}\n${stdout}`.trim();
      if (isNotLoggedInOutput(combined)) {
        reject(new BridgeError('Run `claude` and complete login, then retry.', 'CLI_NOT_AUTHENTICATED', 401));
        return;
      }

      reject(new BridgeError(combined || `claude CLI exited with code ${code}.`, 'CLI_RUNTIME_ERROR', 500));
    });
  });
}

async function checkClaudeCliInstalled() {
  try {
    await runCommand(CLAUDE_CLI_BIN, ['--version'], { timeoutMs: 10000 });
    return { ok: true };
  } catch (error) {
    if (error instanceof BridgeError && error.code === 'CLI_MISSING') {
      return { ok: false, detail: error.message };
    }
    return { ok: false, detail: error instanceof Error ? error.message : 'Unknown CLI check failure.' };
  }
}

async function checkClaudeLoginState() {
  try {
    const configPath = path.join(os.homedir(), '.claude.json');
    const raw = await readFile(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    const oauthAccount = parsed?.oauthAccount;
    if (oauthAccount && typeof oauthAccount === 'object') {
      return { ok: true };
    }

    return { ok: false, detail: 'Run `claude` and complete login, then retry.' };
  } catch {
    return { ok: false, detail: 'Run `claude` and complete login, then retry.' };
  }
}

async function generateStrictJson({ prompt, schema, modelId }) {
  const args = ['-p', prompt, '--json-schema', JSON.stringify(schema), '--output-format', 'json', '--max-turns', '4'];

  if (modelId) {
    args.push('--model', modelId);
  }

  const { stdout } = await runCommand(CLAUDE_CLI_BIN, args, { timeoutMs: REQUEST_TIMEOUT_MS });
  const envelope = parseJsonObjectFromText(stdout);
  if (!envelope) {
    throw new BridgeError('claude CLI returned invalid JSON for provided schema.', 'INVALID_JSON', 500);
  }

  if (typeof envelope.subtype === 'string' && envelope.subtype.startsWith('error')) {
    throw new BridgeError(`claude CLI error: ${envelope.subtype}`, 'CLI_RUNTIME_ERROR', 500);
  }

  const structured = envelope.structured_output;
  if (structured && typeof structured === 'object' && !Array.isArray(structured)) {
    return structured;
  }

  if (typeof envelope.result === 'string') {
    const parsedResult = parseJsonObjectFromText(envelope.result);
    if (parsedResult) {
      return parsedResult;
    }
  }

  if (typeof envelope.type !== 'string') {
    return envelope;
  }

  throw new BridgeError('claude CLI did not return structured_output JSON.', 'INVALID_JSON', 500);
}

function toClientError(error) {
  if (error instanceof BridgeError) {
    return {
      statusCode: error.statusCode,
      ok: false,
      error: error.message,
      code: error.code,
    };
  }

  return {
    statusCode: 500,
    ok: false,
    error: error instanceof Error ? error.message : 'Unknown bridge error.',
    code: 'UNKNOWN',
  };
}

app.get('/health', async (_req, res) => {
  const cli = await checkClaudeCliInstalled();
  if (!cli.ok) {
    res.json({
      ok: false,
      cliInstalled: false,
      loggedIn: false,
      detail: cli.detail || 'Install Claude Code CLI (`claude`).',
    });
    return;
  }

  const login = await checkClaudeLoginState();
  if (!login.ok) {
    res.json({
      ok: false,
      cliInstalled: true,
      loggedIn: false,
      detail: login.detail || 'Run `claude` and complete login.',
    });
    return;
  }

  res.json({
    ok: true,
    cliInstalled: true,
    loggedIn: true,
    detail: 'claude CLI is available and login state looks valid.',
  });
});

app.post('/generate/semantics', async (req, res) => {
  try {
    const payload = assertGeneratePayload(req.body);
    const result = await generateStrictJson(payload);
    res.json(result);
  } catch (error) {
    const payload = toClientError(error);
    res.status(payload.statusCode).json({ ok: false, error: payload.error, code: payload.code });
  }
});

app.post('/generate/workflow', async (req, res) => {
  try {
    const payload = assertGeneratePayload(req.body);
    const result = await generateStrictJson(payload);
    res.json(result);
  } catch (error) {
    const payload = toClientError(error);
    res.status(payload.statusCode).json({ ok: false, error: payload.error, code: payload.code });
  }
});

app.listen(PORT, () => {
  console.log(`[claude-bridge] Listening on http://localhost:${PORT}`);
});
