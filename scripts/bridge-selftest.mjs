const BRIDGE_URL = process.env.CLAUDE_BRIDGE_URL || 'http://localhost:3789';

function bridgeUrl(path) {
  const base = BRIDGE_URL.replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}

async function callJson(path, init = {}) {
  const response = await fetch(bridgeUrl(path), init);
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = payload && typeof payload.error === 'string' ? payload.error : `HTTP ${response.status}`;
    throw new Error(`${path} failed: ${detail}`);
  }
  return payload;
}

async function run() {
  const health = await callJson('/health');
  if (!health || health.ok !== true) {
    throw new Error('/health returned unexpected payload');
  }

  const generated = await callJson('/generate/semantics', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: 'Return JSON with ok=true.',
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
        },
        required: ['ok'],
      },
    }),
  });

  if (!generated || typeof generated !== 'object' || Array.isArray(generated)) {
    throw new Error('/generate/semantics did not return object JSON');
  }

  if (generated.ok !== true) {
    throw new Error('/generate/semantics returned object, but ok !== true');
  }

  console.log('bridge:selftest passed');
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : 'Unknown selftest error';
  console.error(`bridge:selftest failed: ${message}`);
  process.exit(1);
});

