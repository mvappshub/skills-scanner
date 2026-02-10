import { CLAUDE_BRIDGE_URL, getSemanticsModelId, getWorkflowModelId } from '../config';
import { JsonSchema, LlmClient } from '../types';

interface BridgeGenerateRequest {
  modelId?: string;
  prompt: string;
  schema: JsonSchema;
}

const BRIDGE_TIMEOUT_MS = 60000;

function joinBridgeUrl(path: string): string {
  const normalizedBase = CLAUDE_BRIDGE_URL.replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

async function postBridgeJson(path: string, body: BridgeGenerateRequest): Promise<Record<string, unknown>> {
  const abortController = new AbortController();
  const timeoutHandle = setTimeout(() => abortController.abort(), BRIDGE_TIMEOUT_MS);

  try {
    const response = await fetch(joinBridgeUrl(path), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: abortController.signal,
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      if (payload && payload.ok === false && typeof payload.error === 'string') {
        throw new Error(`claude-bridge: ${payload.error}`);
      }
      throw new Error(`claude-bridge: HTTP ${response.status}`);
    }

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('claude-bridge: returned non-object JSON');
    }

    return payload as Record<string, unknown>;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`claude-bridge: request timed out after ${BRIDGE_TIMEOUT_MS}ms`);
    }
    if (error instanceof Error && error.message.startsWith('claude-bridge:')) {
      throw error;
    }

    throw new Error(`claude-bridge not running (${CLAUDE_BRIDGE_URL})`);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

export class ClaudeBridgeProvider implements LlmClient {
  providerId = 'claude-code';

  async generateSemantics(prompt: string, schema: JsonSchema): Promise<Record<string, unknown>> {
    return postBridgeJson('/generate/semantics', {
      modelId: getSemanticsModelId('claude-code'),
      prompt,
      schema,
    });
  }

  async generateWorkflowPlan(prompt: string, schema: JsonSchema): Promise<Record<string, unknown>> {
    return postBridgeJson('/generate/workflow', {
      modelId: getWorkflowModelId('claude-code'),
      prompt,
      schema,
    });
  }

  async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
    try {
      const response = await fetch(joinBridgeUrl('/health'));
      if (!response.ok) {
        return { ok: false, detail: `HTTP ${response.status}` };
      }
      const payload = await response.json().catch(() => null);
      if (!payload || typeof payload !== 'object') {
        return { ok: false, detail: 'Unexpected response payload.' };
      }

      if (payload.ok === true) {
        return { ok: true };
      }

      if (payload.cliInstalled === false) {
        return { ok: false, detail: 'Install Claude Code CLI (`claude`).' };
      }

      if (payload.loggedIn === false) {
        return { ok: false, detail: 'Run `claude` and complete login.' };
      }

      return { ok: false, detail: typeof payload.detail === 'string' ? payload.detail : 'Bridge unavailable.' };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : 'Bridge unavailable' };
    }
  }
}
