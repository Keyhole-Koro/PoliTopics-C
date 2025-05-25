import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

export function loadEnv(filePath: string = '.env') {
  const absPath = resolve(process.cwd(), filePath);
  if (!existsSync(absPath)) return;

  const content = readFileSync(absPath, 'utf-8');
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim().replace(/^['"]|['"]$/g, '');

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}
