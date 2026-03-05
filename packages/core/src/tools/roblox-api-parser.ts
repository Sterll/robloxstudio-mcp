import { readFileSync } from 'fs';
import { join } from 'path';

interface RobloxClassInfo {
  className: string;
  extends: string;
  properties: Array<{ name: string; type: string; readonly: boolean }>;
  methods: Array<{ name: string; signature: string }>;
  events: Array<{ name: string; signature: string }>;
}

let cachedContent: string | null = null;

function getTypesContent(): string {
  if (cachedContent) return cachedContent;
  const filePath = join(process.cwd(), 'studio-plugin', 'node_modules', '@rbxts', 'types', 'include', 'generated', 'None.d.ts');
  cachedContent = readFileSync(filePath, 'utf-8');
  return cachedContent;
}

export function parseRobloxClass(className: string): RobloxClassInfo | null {
  const content = getTypesContent();

  // Find the interface declaration line
  const interfacePattern = new RegExp(`^interface ${className}\\s+extends\\s+(\\S+)`, 'm');
  const interfaceMatch = interfacePattern.exec(content);
  if (!interfaceMatch) return null;

  const parentClass = interfaceMatch[1].replace(/[,{].*/, '').trim();
  const startIdx = interfaceMatch.index;

  // Find the matching closing brace
  let depth = 0;
  let endIdx = startIdx;
  for (let i = startIdx; i < content.length; i++) {
    if (content[i] === '{') depth++;
    else if (content[i] === '}') {
      depth--;
      if (depth === 0) { endIdx = i; break; }
    }
  }

  const body = content.slice(startIdx, endIdx + 1);
  const lines = body.split('\n').slice(1, -1); // skip first (interface decl) and last (closing brace)

  const properties: RobloxClassInfo['properties'] = [];
  const methods: RobloxClassInfo['methods'] = [];
  const events: RobloxClassInfo['events'] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
    // Skip internal nominal markers
    if (trimmed.includes('_nominal_')) continue;

    // Events: readonly X: RBXScriptSignal<...>
    if (trimmed.includes('RBXScriptSignal')) {
      const eventMatch = /readonly\s+(\w+)\s*:\s*(RBXScriptSignal<[^>]*(?:<[^>]*>)*[^;]*)/.exec(trimmed);
      if (eventMatch) {
        events.push({ name: eventMatch[1], signature: eventMatch[2].replace(/;$/, '').trim() });
      }
      continue;
    }

    // Methods: Name(this: ClassName, ...): ReturnType
    if (/\w+\s*\(this:/.test(trimmed)) {
      const methodMatch = /(\w+)\s*(\(this:[^)]*(?:\([^)]*\)[^)]*)*\)[^;]*)/.exec(trimmed);
      if (methodMatch) {
        methods.push({ name: methodMatch[1], signature: methodMatch[2].replace(/;$/, '').trim() });
      }
      continue;
    }

    // Properties: [readonly] Name: Type
    const propMatch = /^(readonly\s+)?(\w+)\s*\??\s*:\s*(.+?)\s*;?\s*$/.exec(trimmed);
    if (propMatch) {
      properties.push({
        name: propMatch[2],
        type: propMatch[3].replace(/;$/, '').trim(),
        readonly: !!propMatch[1],
      });
    }
  }

  return { className, extends: parentClass, properties, methods, events };
}
