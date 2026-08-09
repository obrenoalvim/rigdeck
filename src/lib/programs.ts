import { parseJsonArray } from './json-array.js';
import type { Program } from '../types.js';

export function parseProgramsOutput(json: string): Program[] {
  return parseJsonArray<Program>(json);
}
