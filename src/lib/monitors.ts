import { parseJsonArray } from './json-array.js';
import type { Monitor } from '../types.js';

export function parseMonitorsOutput(json: string): Monitor[] {
  return parseJsonArray<Monitor>(json);
}
