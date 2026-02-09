import { spawn } from 'node:child_process';

const provider = process.argv[2];
const bridgeUrl = process.argv[3];

if (!provider) {
  console.error('Usage: node scripts/dev-with-provider.mjs <provider> [bridgeUrl]');
  process.exit(1);
}

const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const env = {
  ...process.env,
  VITE_LLM_PROVIDER: provider,
};

if (bridgeUrl) {
  env.VITE_CLAUDE_BRIDGE_URL = bridgeUrl;
}

const child = spawn(command, ['run', 'dev'], {
  stdio: 'inherit',
  env,
});

child.on('exit', (code) => {
  process.exit(code ?? 1);
});

