import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import Anthropic from '@anthropic-ai/sdk';

dotenv.config();

const PORT = Number(process.env.CLAUDE_BRIDGE_PORT || 3789);
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
      if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
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

async function generateStrictJson({ prompt, schema, modelId }) {
  const response = await anthropic.messages.create({
    model: modelId || DEFAULT_MODEL,
    max_tokens: 4096,
    temperature: 0,
    tools: [
      {
        name: 'submit_json',
        description: 'Return JSON that strictly matches the provided JSON schema.',
        input_schema: schema,
      },
    ],
    tool_choice: { type: 'tool', name: 'submit_json' },
    messages: [{ role: 'user', content: prompt }],
  });

  const toolUse = response.content.find((block) => block.type === 'tool_use' && block.name === 'submit_json');
  if (!toolUse) {
    throw new Error('Claude did not return structured tool output.');
  }

  const payload = toolUse.input;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Claude returned invalid structured payload.');
  }

  return payload;
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
    const message = error instanceof Error ? error.message : 'Unknown bridge error';
    res.status(500).json({ error: message });
  }
});

app.post('/generate/workflow', async (req, res) => {
  try {
    const payload = assertGeneratePayload(req.body);
    const result = await generateStrictJson(payload);
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown bridge error';
    res.status(500).json({ error: message });
  }
});

app.listen(PORT, () => {
  console.log(`[claude-bridge] Listening on http://localhost:${PORT}`);
});

