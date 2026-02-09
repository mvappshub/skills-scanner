import { CLAUDE_BRIDGE_URL, getSemanticsModelId, getWorkflowModelId } from '../config';
import { JsonSchema, LlmClient } from '../types';

interface BridgeGenerateRequest {
  modelId?: string;
  prompt: string;
  schema: JsonSchema;
}

function joinBridgeUrl(path: string): string {
  const normalizedBase = CLAUDE_BRIDGE_URL.replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

async function postBridgeJson(path: string, body: BridgeGenerateRequest): Promise<Record<string, unknown>> {
  const response = await fetch(joinBridgeUrl(path), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = payload && typeof payload.error === 'string' ? payload.error : `HTTP ${response.status}`;
    throw new Error(`Claude bridge request failed: ${detail}`);
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Claude bridge returned non-object JSON.');
  }

  return payload as Record<string, unknown>;
}

export class ClaudeBridgeProvider implements LlmClient {
  providerId = 'claude-bridge';

  async generateSemantics(prompt: string, schema: JsonSchema): Promise<Record<string, unknown>> {
    return postBridgeJson('/generate/semantics', {
      modelId: getSemanticsModelId('claude-bridge'),
      prompt,
      schema,
    });
  }

  async generateWorkflowPlan(prompt: string, schema: JsonSchema): Promise<Record<string, unknown>> {
    return postBridgeJson('/generate/workflow', {
      modelId: getWorkflowModelId('claude-bridge'),
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
      if (!payload || payload.ok !== true) {
        return { ok: false, detail: 'Unexpected response payload.' };
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : 'Bridge unavailable' };
    }
  }
}

