import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import Anthropic from '@anthropic-ai/sdk';

dotenv.config();

const PORT = Number(process.env.CLAUDE_BRIDGE_PORT || 3789);
const REQUEST_TIMEOUT_MS = Number(process.env.CLAUDE_BRIDGE_TIMEOUT_MS || 60000);
const DEFAULT_MODEL = process.env.CLAUDE_MODEL_ID || 'claude-3-5-sonnet-latest';
const API_KEY = process.env.ANTHROPIC_API_KEY;
const allowedOrigins = (process.env.CLAUDE_BRIDGE_ALLOWED_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);

if (!API_KEY) {
  console.error('[claude-bridge] Missing ANTHROPIC_API_KEY in environment.');
  process.exit(1);
}

const anthropic = new Anthropic({ apiKey: API_KEY });
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

function assertGeneratePayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Body must be a JSON object.');
  }

  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  const schema = body.schema;
  const modelId = typeof body.modelId === 'string' ? body.modelId.trim() : undefined;

  if (!prompt) {
    throw new Error('Missing required field: prompt.');
  }

  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new Error('Missing required field: schema (JSON object).');
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

async function generateStrictJson({ prompt, schema, modelId }) {
  const abortController = new AbortController();
  const timeoutHandle = setTimeout(() => abortController.abort(), REQUEST_TIMEOUT_MS);
  let response;

  try {
    response = await anthropic.messages.create(
      {
        model: modelId || DEFAULT_MODEL,
        max_tokens: 4096,
        temperature: 0,
        output_config: {
          format: {
            type: 'json_schema',
            schema,
          },
        },
        messages: [{ role: 'user', content: prompt }],
      },
      { signal: abortController.signal },
    );
  } catch (error) {
    if (abortController.signal.aborted) {
      const timeoutError = new Error(`Claude request timed out after ${REQUEST_TIMEOUT_MS} ms.`);
      timeoutError.name = 'TimeoutError';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }

  for (const block of response.content || []) {
    if (block?.type === 'output_json' && block.json && typeof block.json === 'object' && !Array.isArray(block.json)) {
      return block.json;
    }

    if (block?.type === 'text' && typeof block.text === 'string') {
      const parsed = parseJsonObjectFromText(block.text);
      if (parsed) {
        return parsed;
      }
    }
  }

  throw new Error('Claude returned invalid structured JSON payload.');
}

function toClientError(error) {
  const isTimeout = error?.name === 'AbortError' || error?.name === 'TimeoutError';
  const status = typeof error?.status === 'number' ? error.status : undefined;
  const code =
    typeof error?.error?.error?.type === 'string'
      ? error.error.error.type
      : typeof error?.error?.type === 'string'
        ? error.error.type
        : undefined;
  const upstreamMessage =
    typeof error?.error?.error?.message === 'string'
      ? error.error.error.message
      : typeof error?.error?.message === 'string'
        ? error.error.message
        : undefined;
  const message = upstreamMessage || (status ? 'Upstream request failed.' : error instanceof Error ? error.message : 'Unknown bridge error');
  return {
    statusCode: isTimeout ? 504 : 500,
    ok: false,
    error: status ? `Claude API error (${status}${code ? `/${code}` : ''}): ${message}` : message,
  };
}

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/generate/semantics', async (req, res) => {
  try {
    const payload = assertGeneratePayload(req.body);
    const result = await generateStrictJson(payload);
    res.json(result);
  } catch (error) {
    const payload = toClientError(error);
    res.status(payload.statusCode).json({ ok: false, error: payload.error });
  }
});

app.post('/generate/workflow', async (req, res) => {
  try {
    const payload = assertGeneratePayload(req.body);
    const result = await generateStrictJson(payload);
    res.json(result);
  } catch (error) {
    const payload = toClientError(error);
    res.status(payload.statusCode).json({ ok: false, error: payload.error });
  }
});

app.listen(PORT, () => {
  console.log(`[claude-bridge] Listening on http://localhost:${PORT}`);
});
