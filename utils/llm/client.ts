import { LLM_PROVIDER } from './config';
import { ClaudeBridgeProvider } from './providers/claudeBridge';
import { GeminiProvider } from './providers/gemini';
import { LlmClient } from './types';

let singleton: LlmClient | null = null;

function createClient(): LlmClient {
  if (LLM_PROVIDER === 'claude-bridge') {
    return new ClaudeBridgeProvider();
  }
  return new GeminiProvider();
}

export function getLlmClient(): LlmClient {
  if (!singleton || singleton.providerId !== LLM_PROVIDER) {
    singleton = createClient();
  }
  return singleton;
}

