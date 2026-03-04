# Batch Execute + VFX + Tools Expansion — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ajouter `batch_execute` (N opérations en 1 round-trip HTTP) + 20 nouveaux tools (VFX, audio, caméra, hiérarchie, scripts, contexte).

**Architecture:** `batch_execute` envoie `{operations:[{endpoint,data}[]]}` au plugin qui exécute chaque op via `processRequest` et retourne un tableau de résultats. Les nouveaux tools suivent le pattern 4-fichiers : `definitions.ts` → `index.ts` → `http-server.ts` → handler plugin + `Communication.ts`.

**Tech Stack:** TypeScript (serveur Node.js), roblox-ts (plugin Luau), Jest + supertest (tests)

---

## Référence rapide — patterns

### Server side (3 fichiers toujours modifiés ensemble)

**`definitions.ts`** — ajouter dans `TOOL_DEFINITIONS`:
```typescript
{
  name: 'tool_name',
  description: 'Description',
  inputSchema: {
    type: 'object',
    properties: { param: { type: 'string', description: '...' } },
    required: ['param'],
  },
}
```

**`index.ts`** — ajouter méthode dans `RobloxStudioTools`:
```typescript
async toolMethod(param: string) {
  const response = await this.client.request('/api/endpoint', { param });
  return { content: [{ type: 'text', text: JSON.stringify(response) }] };
}
```

**`http-server.ts`** — ajouter dans `TOOL_HANDLERS`:
```typescript
tool_name: (tools, body) => tools.toolMethod(body.param),
```

### Plugin side (roblox-ts)

**Handler file** — pattern standard:
```typescript
import Utils from "../Utils";
import Recording from "../Recording";
const { getInstancePath, getInstanceByPath, convertPropertyValue } = Utils;
const { beginRecording, finishRecording } = Recording;

function myHandler(requestData: Record<string, unknown>) {
  const path = requestData.instancePath as string;
  if (!path) return { error: "instancePath is required" };
  const instance = getInstanceByPath(path);
  if (!instance) return { error: `Not found: ${path}` };
  const recordingId = beginRecording("Action name");
  const [success, err] = pcall(() => { /* ... */ });
  finishRecording(recordingId, success);
  if (success) return { success: true };
  return { error: tostring(err) };
}
export = { myHandler };
```

**`Communication.ts`** — ajouter import + route:
```typescript
import MyHandlers from "./handlers/MyHandlers";
// dans routeMap:
"/api/my-endpoint": MyHandlers.myHandler,
```

### Build commands
```bash
# Server
cd E:/Roblox/robloxstudio-mcp && npm run build

# Plugin (depuis la racine)
cd studio-plugin && npx rbxtsc && cd ..
npm run build:plugin

# Tests
npm test
```

---

## Task 1: `batch_execute` — Server side

**Files:**
- Modify: `packages/core/src/tools/definitions.ts`
- Modify: `packages/core/src/tools/index.ts`
- Modify: `packages/core/src/http-server.ts`

### Step 1: Ajouter la définition du tool dans `definitions.ts`

Dans le tableau `TOOL_DEFINITIONS`, ajouter après le dernier tool existant :

```typescript
{
  name: 'batch_execute',
  description: 'Execute multiple operations in a single round-trip. Returns an array of results in the same order as operations.',
  inputSchema: {
    type: 'object',
    properties: {
      operations: {
        type: 'array',
        description: 'List of operations to execute sequentially',
        items: {
          type: 'object',
          properties: {
            tool: { type: 'string', description: 'Tool name (e.g. "create_object", "set_property")' },
            args: { type: 'object', description: 'Arguments for the tool', additionalProperties: true },
          },
          required: ['tool', 'args'],
        },
      },
    },
    required: ['operations'],
  },
},
```

### Step 2: Ajouter la méthode dans `index.ts`

Dans la classe `RobloxStudioTools`, ajouter :

```typescript
async batchExecute(operations: Array<{ tool: string; args: Record<string, unknown> }>) {
  const pluginOps = operations.map(op => ({
    endpoint: `/api/${op.tool.replace(/_/g, '-')}`,
    data: op.args,
  }));
  const response = await this.client.request('/api/batch-execute', { operations: pluginOps });
  return {
    content: [{ type: 'text', text: JSON.stringify(response) }],
  };
}
```

### Step 3: Ajouter dans `TOOL_HANDLERS` dans `http-server.ts`

```typescript
batch_execute: (tools, body) => tools.batchExecute(body.operations),
```

### Step 4: Lancer le build server

```bash
cd E:/Roblox/robloxstudio-mcp && npm run build
```

Attendu : aucune erreur TypeScript.

---

## Task 2: `batch_execute` — Plugin side

**Files:**
- Modify: `studio-plugin/src/modules/Communication.ts`

### Step 1: Ajouter la fonction `batchExecute` dans `Communication.ts`

Juste avant la ligne `function processRequest(...)`, ajouter :

```typescript
function batchExecute(requestData: Record<string, unknown>): unknown {
	const operations = requestData.operations as Array<{ endpoint: string; data: Record<string, unknown> }>;
	if (!operations || !typeIs(operations, "table")) {
		return { error: "operations array is required" };
	}

	const results: unknown[] = [];
	let allSucceeded = true;

	for (const op of operations) {
		const [ok, result] = pcall(() =>
			processRequest({ endpoint: op.endpoint, data: op.data ?? {} })
		);
		if (ok) {
			results.push(result);
			if (typeIs(result, "table") && (result as Record<string, unknown>).error !== undefined) {
				allSucceeded = false;
			}
		} else {
			results.push({ error: tostring(result) });
			allSucceeded = false;
		}
	}

	return { results, allSucceeded, count: (operations as defined[]).size() };
}
```

**Attention :** `batchExecute` doit être déclarée APRÈS `processRequest` dans le fichier, car elle l'appelle. Si `processRequest` est déclarée après, déplacer `batchExecute` en-dessous.

### Step 2: Ajouter la route dans `routeMap`

```typescript
"/api/batch-execute": batchExecute,
```

### Step 3: Build plugin

```bash
cd E:/Roblox/robloxstudio-mcp/studio-plugin && npx rbxtsc
```

Attendu : aucune erreur roblox-ts.

### Step 4: Build final + commit

```bash
cd E:/Roblox/robloxstudio-mcp && npm run build:plugin
git add packages/core/src/tools/definitions.ts packages/core/src/tools/index.ts packages/core/src/http-server.ts studio-plugin/src/modules/Communication.ts
git commit -m "feat: add batch_execute tool — N operations in 1 round-trip"
```

---

## Task 3: Hierarchy tools — Server side (5 tools)

**Files:**
- Modify: `packages/core/src/tools/definitions.ts`
- Modify: `packages/core/src/tools/index.ts`
- Modify: `packages/core/src/http-server.ts`

### Step 1: Ajouter 5 définitions dans `definitions.ts`

```typescript
{
  name: 'move_object',
  description: 'Re-parent an instance to a new parent',
  inputSchema: {
    type: 'object',
    properties: {
      instancePath: { type: 'string', description: 'Path of instance to move' },
      newParent: { type: 'string', description: 'Path of the new parent' },
    },
    required: ['instancePath', 'newParent'],
  },
},
{
  name: 'rename_object',
  description: 'Rename an instance (sets its Name property)',
  inputSchema: {
    type: 'object',
    properties: {
      instancePath: { type: 'string', description: 'Path of instance to rename' },
      newName: { type: 'string', description: 'New name for the instance' },
    },
    required: ['instancePath', 'newName'],
  },
},
{
  name: 'clone_instance',
  description: 'Clone an instance to a new parent, with optional position',
  inputSchema: {
    type: 'object',
    properties: {
      instancePath: { type: 'string', description: 'Path of instance to clone' },
      parent: { type: 'string', description: 'Path of parent for the clone' },
      position: {
        type: 'array',
        items: { type: 'number' },
        description: 'Optional [x,y,z] position if clone is a BasePart',
      },
    },
    required: ['instancePath', 'parent'],
  },
},
{
  name: 'get_descendants_by_class',
  description: 'Get all descendants of a given class under a path',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Root path to search under' },
      className: { type: 'string', description: 'Exact class name to filter (e.g. "Part", "Script")' },
    },
    required: ['path', 'className'],
  },
},
{
  name: 'set_multiple_properties',
  description: 'Set multiple properties on a single instance in one call',
  inputSchema: {
    type: 'object',
    properties: {
      instancePath: { type: 'string', description: 'Path of the instance' },
      properties: {
        type: 'object',
        description: 'Map of propertyName → value',
        additionalProperties: true,
      },
    },
    required: ['instancePath', 'properties'],
  },
},
```

### Step 2: Ajouter 5 méthodes dans `index.ts`

```typescript
async moveObject(instancePath: string, newParent: string) {
  const response = await this.client.request('/api/move-object', { instancePath, newParent });
  return { content: [{ type: 'text', text: JSON.stringify(response) }] };
}

async renameObject(instancePath: string, newName: string) {
  const response = await this.client.request('/api/rename-object', { instancePath, newName });
  return { content: [{ type: 'text', text: JSON.stringify(response) }] };
}

async cloneInstance(instancePath: string, parent: string, position?: number[]) {
  const response = await this.client.request('/api/clone-instance', { instancePath, parent, position });
  return { content: [{ type: 'text', text: JSON.stringify(response) }] };
}

async getDescendantsByClass(path: string, className: string) {
  const response = await this.client.request('/api/get-descendants-by-class', { path, className });
  return { content: [{ type: 'text', text: JSON.stringify(response) }] };
}

async setMultipleProperties(instancePath: string, properties: Record<string, unknown>) {
  const response = await this.client.request('/api/set-multiple-properties', { instancePath, properties });
  return { content: [{ type: 'text', text: JSON.stringify(response) }] };
}
```

### Step 3: Ajouter dans `TOOL_HANDLERS` dans `http-server.ts`

```typescript
move_object: (tools, body) => tools.moveObject(body.instancePath, body.newParent),
rename_object: (tools, body) => tools.renameObject(body.instancePath, body.newName),
clone_instance: (tools, body) => tools.cloneInstance(body.instancePath, body.parent, body.position),
get_descendants_by_class: (tools, body) => tools.getDescendantsByClass(body.path, body.className),
set_multiple_properties: (tools, body) => tools.setMultipleProperties(body.instancePath, body.properties),
```

### Step 4: Build server

```bash
npm run build
```

---

## Task 4: Hierarchy tools — Plugin side

**Files:**
- Modify: `studio-plugin/src/modules/handlers/InstanceHandlers.ts`
- Modify: `studio-plugin/src/modules/handlers/PropertyHandlers.ts`
- Modify: `studio-plugin/src/modules/Communication.ts`

### Step 1: Ajouter 4 fonctions dans `InstanceHandlers.ts`

Avant la ligne `export = { ... }`, ajouter :

```typescript
function moveObject(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	const newParentPath = requestData.newParent as string;
	if (!instancePath || !newParentPath) return { error: "instancePath and newParent are required" };

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}` };
	const newParent = getInstanceByPath(newParentPath);
	if (!newParent) return { error: `New parent not found: ${newParentPath}` };

	const recordingId = beginRecording(`Move ${instance.Name}`);
	const [success, err] = pcall(() => { instance.Parent = newParent; });
	finishRecording(recordingId, success);

	if (success) return { success: true, instancePath: getInstancePath(instance), message: "Instance moved" };
	return { error: `Failed to move: ${tostring(err)}` };
}

function renameObject(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	const newName = requestData.newName as string;
	if (!instancePath || !newName) return { error: "instancePath and newName are required" };

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}` };

	const oldName = instance.Name;
	const recordingId = beginRecording(`Rename ${oldName} → ${newName}`);
	const [success, err] = pcall(() => { instance.Name = newName; });
	finishRecording(recordingId, success);

	if (success) return { success: true, oldName, newName, instancePath: getInstancePath(instance) };
	return { error: `Failed to rename: ${tostring(err)}` };
}

function cloneInstance(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	const parentPath = requestData.parent as string;
	const position = requestData.position as number[] | undefined;
	if (!instancePath || !parentPath) return { error: "instancePath and parent are required" };

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}` };
	const parent = getInstanceByPath(parentPath);
	if (!parent) return { error: `Parent not found: ${parentPath}` };

	const recordingId = beginRecording(`Clone ${instance.Name}`);
	const [success, clone] = pcall(() => {
		const c = instance.Clone();
		if (position && c.IsA("BasePart")) {
			c.Position = new Vector3(position[0] ?? 0, position[1] ?? 0, position[2] ?? 0);
		}
		c.Parent = parent;
		return c;
	});
	finishRecording(recordingId, success);

	if (success && clone) {
		return { success: true, instancePath: getInstancePath(clone as Instance), name: (clone as Instance).Name };
	}
	return { error: `Failed to clone: ${tostring(clone)}` };
}

function getDescendantsByClass(requestData: Record<string, unknown>) {
	const path = requestData.path as string;
	const className = requestData.className as string;
	if (!path || !className) return { error: "path and className are required" };

	const root = getInstanceByPath(path);
	if (!root) return { error: `Instance not found: ${path}` };

	const results: Record<string, unknown>[] = [];
	const [success, err] = pcall(() => {
		for (const desc of root.GetDescendants()) {
			if (desc.ClassName === className) {
				results.push({ path: getInstancePath(desc), name: desc.Name, className: desc.ClassName });
			}
		}
	});

	if (!success) return { error: tostring(err) };
	return { count: results.size(), results };
}
```

Mettre à jour l'export :
```typescript
export = {
  createObject,
  deleteObject,
  massCreateObjects,
  massCreateObjectsWithProperties,
  smartDuplicate,
  massDuplicate,
  moveObject,
  renameObject,
  cloneInstance,
  getDescendantsByClass,
};
```

### Step 2: Ajouter `setMultipleProperties` dans `PropertyHandlers.ts`

Lire d'abord le fichier pour voir les imports existants, puis ajouter avant `export = { ... }` :

```typescript
function setMultipleProperties(requestData: Record<string, unknown>) {
	const instancePath = requestData.instancePath as string;
	const properties = requestData.properties as Record<string, unknown>;
	if (!instancePath || !properties) return { error: "instancePath and properties are required" };

	const instance = getInstanceByPath(instancePath);
	if (!instance) return { error: `Instance not found: ${instancePath}` };

	const recordingId = beginRecording(`Set multiple properties on ${instance.Name}`);
	const results: Record<string, unknown> = {};
	let failures = 0;

	for (const [propName, propValue] of pairs(properties)) {
		const propNameStr = tostring(propName);
		const [ok, err] = pcall(() => {
			const converted = convertPropertyValue(instance, propNameStr, propValue);
			(instance as unknown as Record<string, unknown>)[propNameStr] = converted !== undefined ? converted : propValue;
		});
		results[propNameStr] = ok ? "ok" : tostring(err);
		if (!ok) failures++;
	}

	finishRecording(recordingId, failures === 0);
	return { success: failures === 0, instancePath, results, failures };
}
```

Ajouter `setMultipleProperties` dans `export = { ... }`.

### Step 3: Ajouter les routes dans `Communication.ts`

```typescript
"/api/move-object": InstanceHandlers.moveObject,
"/api/rename-object": InstanceHandlers.renameObject,
"/api/clone-instance": InstanceHandlers.cloneInstance,
"/api/get-descendants-by-class": InstanceHandlers.getDescendantsByClass,
"/api/set-multiple-properties": PropertyHandlers.setMultipleProperties,
```

### Step 4: Build + commit

```bash
cd studio-plugin && npx rbxtsc && cd ..
npm run build:plugin
git add -A
git commit -m "feat: add hierarchy tools — move, rename, clone, get_descendants, set_multiple_properties"
```

---

## Task 5: Context tools — Server + Plugin

**Files:**
- Modify: `packages/core/src/tools/definitions.ts`
- Modify: `packages/core/src/tools/index.ts`
- Modify: `packages/core/src/http-server.ts`
- Modify: `studio-plugin/src/modules/handlers/MetadataHandlers.ts`
- Modify: `studio-plugin/src/modules/Communication.ts`

### Step 1: Ajouter 2 définitions dans `definitions.ts`

```typescript
{
  name: 'get_context',
  description: 'Fast snapshot: selected object, game name, services, script count. Ideal as first call to understand the scene.',
  inputSchema: { type: 'object', properties: {} },
},
{
  name: 'get_deep_snapshot',
  description: 'Get full subtree of an object (children + properties) recursively',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Root path to snapshot' },
      maxDepth: { type: 'number', description: 'Max recursion depth (default: 3)' },
    },
    required: ['path'],
  },
},
```

### Step 2: Ajouter méthodes dans `index.ts`

```typescript
async getContext() {
  const response = await this.client.request('/api/get-context', {});
  return { content: [{ type: 'text', text: JSON.stringify(response) }] };
}

async getDeepSnapshot(path: string, maxDepth?: number) {
  const response = await this.client.request('/api/get-deep-snapshot', { path, maxDepth });
  return { content: [{ type: 'text', text: JSON.stringify(response) }] };
}
```

### Step 3: Ajouter dans `TOOL_HANDLERS`

```typescript
get_context: (tools) => tools.getContext(),
get_deep_snapshot: (tools, body) => tools.getDeepSnapshot(body.path, body.maxDepth),
```

### Step 4: Implémenter dans `MetadataHandlers.ts`

Lire d'abord le fichier pour voir les imports. Ajouter :

```typescript
const SelectionService = game.GetService("Selection");

function getContext(_requestData: Record<string, unknown>) {
	const selection = SelectionService.Get();
	const selected = selection.size() > 0 ? selection[0] : undefined;

	const scripts: string[] = [];
	pcall(() => {
		for (const desc of game.GetDescendants()) {
			if (desc.IsA("LuaSourceContainer")) {
				scripts.push(getInstancePath(desc));
			}
		}
	});

	const topScripts: string[] = [];
	const limit = math.min(10, scripts.size());
	for (let i = 0; i < limit; i++) {
		topScripts.push(scripts[i]);
	}

	const services: string[] = [];
	for (const name of ["Workspace", "ServerScriptService", "StarterPlayerScripts", "ReplicatedStorage", "ServerStorage", "StarterGui"] as string[]) {
		const [ok] = pcall(() => game.GetService(name as keyof Services));
		if (ok) services.push(name);
	}

	return {
		gameName: game.Name,
		placeId: game.PlaceId,
		selectedPath: selected ? getInstancePath(selected) : undefined,
		selectedClass: selected ? selected.ClassName : undefined,
		scriptCount: scripts.size(),
		topScripts,
		services,
	};
}

function getDeepSnapshot(requestData: Record<string, unknown>) {
	const instancePath = requestData.path as string;
	const maxDepth = (requestData.maxDepth as number | undefined) ?? 3;
	if (!instancePath) return { error: "path is required" };

	const root = getInstanceByPath(instancePath);
	if (!root) return { error: `Instance not found: ${instancePath}` };

	function snapshotNode(inst: Instance, depth: number): Record<string, unknown> {
		const node: Record<string, unknown> = {
			name: inst.Name,
			className: inst.ClassName,
			path: getInstancePath(inst),
		};
		const children = inst.GetChildren();
		node.childCount = children.size();
		if (depth < maxDepth) {
			const childNodes: Record<string, unknown>[] = [];
			pcall(() => {
				for (const child of children) {
					childNodes.push(snapshotNode(child, depth + 1));
				}
			});
			node.children = childNodes;
		}
		return node;
	}

	return snapshotNode(root, 0);
}
```

Ajouter `getContext` et `getDeepSnapshot` dans `export = { ... }`.

### Step 5: Ajouter routes dans `Communication.ts`

```typescript
"/api/get-context": MetadataHandlers.getContext,
"/api/get-deep-snapshot": MetadataHandlers.getDeepSnapshot,
```

### Step 6: Build + commit

```bash
cd studio-plugin && npx rbxtsc && cd ..
npm run build:plugin
git add -A
git commit -m "feat: add context tools — get_context, get_deep_snapshot"
```

---

## Task 6: Créer `VFXHandlers.ts` + `create_light` + `create_particle_effect`

**Files:**
- Create: `studio-plugin/src/modules/handlers/VFXHandlers.ts`
- Modify: `packages/core/src/tools/definitions.ts`
- Modify: `packages/core/src/tools/index.ts`
- Modify: `packages/core/src/http-server.ts`
- Modify: `studio-plugin/src/modules/Communication.ts`

### Step 1: Créer `VFXHandlers.ts`

```typescript
import Utils from "../Utils";
import Recording from "../Recording";

const { getInstancePath, getInstanceByPath } = Utils;
const { beginRecording, finishRecording } = Recording;

// Helper: build ColorSequence from [{time, rgb}] array
function buildColorSequence(data: Array<{ time: number; rgb: number[] }>): ColorSequence {
	if (data.size() === 0) return new ColorSequence(Color3.fromRGB(255, 255, 255));
	const kps: ColorSequenceKeypoint[] = [];
	for (const kp of data) {
		kps.push(new ColorSequenceKeypoint(
			kp.time,
			Color3.fromRGB(kp.rgb[0] ?? 255, kp.rgb[1] ?? 255, kp.rgb[2] ?? 255),
		));
	}
	return new ColorSequence(kps);
}

// Helper: build NumberSequence from [{time, value}] array
function buildNumberSequence(data: Array<{ time: number; value: number }>): NumberSequence {
	if (data.size() === 0) return new NumberSequence(1);
	const kps: NumberSequenceKeypoint[] = [];
	for (const kp of data) {
		kps.push(new NumberSequenceKeypoint(kp.time, kp.value));
	}
	return new NumberSequence(kps);
}

function createLight(requestData: Record<string, unknown>) {
	const lightType = requestData.type as string;
	const parentPath = requestData.parent as string;
	if (!parentPath) return { error: "parent is required" };

	const validTypes = ["PointLight", "SpotLight", "SurfaceLight"];
	if (!lightType || !validTypes.includes(lightType)) {
		return { error: `type must be one of: ${validTypes.join(", ")}` };
	}

	const parentInst = getInstanceByPath(parentPath);
	if (!parentInst) return { error: `Parent not found: ${parentPath}` };

	const brightness = (requestData.brightness as number | undefined) ?? 1;
	const range = (requestData.range as number | undefined) ?? 16;
	const colorRaw = requestData.color as number[] | undefined;
	const color = colorRaw
		? Color3.fromRGB(colorRaw[0] ?? 255, colorRaw[1] ?? 255, colorRaw[2] ?? 255)
		: Color3.fromRGB(255, 255, 255);
	const enabled = requestData.enabled !== false;

	const recordingId = beginRecording(`Create ${lightType}`);
	const [success, light] = pcall(() => {
		const l = new Instance(lightType as keyof CreatableInstances);
		(l as unknown as { Brightness: number }).Brightness = brightness;
		(l as unknown as { Range: number }).Range = range;
		(l as unknown as { Color: Color3 }).Color = color;
		(l as unknown as { Enabled: boolean }).Enabled = enabled;
		l.Parent = parentInst;
		return l;
	});
	finishRecording(recordingId, success);

	if (success && light) {
		return { success: true, type: lightType, path: getInstancePath(light as Instance) };
	}
	return { error: `Failed to create ${lightType}: ${tostring(light)}` };
}

function createParticleEffect(requestData: Record<string, unknown>) {
	const parentPath = requestData.parent as string;
	if (!parentPath) return { error: "parent is required" };
	const parentInst = getInstanceByPath(parentPath);
	if (!parentInst) return { error: `Parent not found: ${parentPath}` };

	const recordingId = beginRecording("Create ParticleEmitter");
	const [success, emitter] = pcall(() => {
		const pe = new Instance("ParticleEmitter");
		if (requestData.name) pe.Name = requestData.name as string;
		if (requestData.rate !== undefined) pe.Rate = requestData.rate as number;
		if (requestData.lifetime !== undefined) {
			const lt = requestData.lifetime as number[];
			pe.Lifetime = new NumberRange(lt[0] ?? 1, lt[1] ?? 1);
		}
		if (requestData.speed !== undefined) {
			const sp = requestData.speed as number[];
			pe.Speed = new NumberRange(sp[0] ?? 5, sp[1] ?? 5);
		}
		if (requestData.color !== undefined) {
			pe.Color = buildColorSequence(requestData.color as Array<{ time: number; rgb: number[] }>);
		}
		if (requestData.size !== undefined) {
			pe.Size = buildNumberSequence(requestData.size as Array<{ time: number; value: number }>);
		}
		if (requestData.transparency !== undefined) {
			pe.Transparency = buildNumberSequence(requestData.transparency as Array<{ time: number; value: number }>);
		}
		if (requestData.lightEmission !== undefined) pe.LightEmission = requestData.lightEmission as number;
		if (requestData.lightInfluence !== undefined) pe.LightInfluence = requestData.lightInfluence as number;
		if (requestData.texture !== undefined) pe.Texture = requestData.texture as string;
		if (requestData.rotSpeed !== undefined) {
			const rs = requestData.rotSpeed as number[];
			pe.RotSpeed = new NumberRange(rs[0] ?? 0, rs[1] ?? 0);
		}
		if (requestData.rotation !== undefined) {
			const r = requestData.rotation as number[];
			pe.Rotation = new NumberRange(r[0] ?? 0, r[1] ?? 0);
		}
		if (requestData.acceleration !== undefined) {
			const acc = requestData.acceleration as number[];
			pe.Acceleration = new Vector3(acc[0] ?? 0, acc[1] ?? 0, acc[2] ?? 0);
		}
		if (requestData.spreadAngle !== undefined) {
			const sa = requestData.spreadAngle as number[];
			pe.SpreadAngle = new Vector2(sa[0] ?? 0, sa[1] ?? 0);
		}
		if (requestData.enabled !== undefined) pe.Enabled = requestData.enabled as boolean;
		pe.Parent = parentInst;
		return pe;
	});
	finishRecording(recordingId, success);

	if (success && emitter) {
		return { success: true, path: getInstancePath(emitter as Instance) };
	}
	return { error: `Failed to create ParticleEmitter: ${tostring(emitter)}` };
}

export = { createLight, createParticleEffect, buildColorSequence, buildNumberSequence };
```

### Step 2: Ajouter définitions dans `definitions.ts`

```typescript
{
  name: 'create_light',
  description: 'Create a PointLight, SpotLight or SurfaceLight under a parent instance',
  inputSchema: {
    type: 'object',
    properties: {
      type: { type: 'string', description: '"PointLight" | "SpotLight" | "SurfaceLight"' },
      parent: { type: 'string', description: 'Parent instance path' },
      brightness: { type: 'number', description: 'Brightness (default: 1)' },
      range: { type: 'number', description: 'Range in studs (default: 16)' },
      color: { type: 'array', items: { type: 'number' }, description: '[r, g, b] 0-255 (default: white)' },
      enabled: { type: 'boolean', description: 'Enabled state (default: true)' },
    },
    required: ['type', 'parent'],
  },
},
{
  name: 'create_particle_effect',
  description: 'Create a fully configured ParticleEmitter. ColorSequence and NumberSequence are built from simple arrays.',
  inputSchema: {
    type: 'object',
    properties: {
      parent: { type: 'string', description: 'Parent instance path' },
      name: { type: 'string', description: 'Name for the emitter (default: ParticleEmitter)' },
      rate: { type: 'number', description: 'Particles per second' },
      lifetime: { type: 'array', items: { type: 'number' }, description: '[min, max] lifetime in seconds' },
      speed: { type: 'array', items: { type: 'number' }, description: '[min, max] speed' },
      color: {
        type: 'array',
        description: 'ColorSequence: [{time: 0, rgb: [255,0,0]}, {time: 1, rgb: [0,0,255]}]',
        items: { type: 'object', additionalProperties: true },
      },
      size: {
        type: 'array',
        description: 'NumberSequence for size: [{time: 0, value: 1}, {time: 1, value: 0}]',
        items: { type: 'object', additionalProperties: true },
      },
      transparency: {
        type: 'array',
        description: 'NumberSequence for transparency',
        items: { type: 'object', additionalProperties: true },
      },
      lightEmission: { type: 'number', description: '0-1' },
      lightInfluence: { type: 'number', description: '0-1' },
      texture: { type: 'string', description: 'rbxassetid://...' },
      spreadAngle: { type: 'array', items: { type: 'number' }, description: '[x, y] spread in degrees' },
      acceleration: { type: 'array', items: { type: 'number' }, description: '[x, y, z] acceleration vector' },
      enabled: { type: 'boolean' },
    },
    required: ['parent'],
  },
},
```

### Step 3: Ajouter méthodes dans `index.ts`

```typescript
async createLight(type: string, parent: string, brightness?: number, range?: number, color?: number[], enabled?: boolean) {
  const response = await this.client.request('/api/create-light', { type, parent, brightness, range, color, enabled });
  return { content: [{ type: 'text', text: JSON.stringify(response) }] };
}

async createParticleEffect(parent: string, options?: Record<string, unknown>) {
  const response = await this.client.request('/api/create-particle-effect', { parent, ...options });
  return { content: [{ type: 'text', text: JSON.stringify(response) }] };
}
```

### Step 4: Ajouter dans `TOOL_HANDLERS`

```typescript
create_light: (tools, body) => tools.createLight(body.type, body.parent, body.brightness, body.range, body.color, body.enabled),
create_particle_effect: (tools, body) => tools.createParticleEffect(body.parent, body),
```

### Step 5: Importer + ajouter routes dans `Communication.ts`

```typescript
import VFXHandlers from "./handlers/VFXHandlers";
// dans routeMap:
"/api/create-light": VFXHandlers.createLight,
"/api/create-particle-effect": VFXHandlers.createParticleEffect,
```

### Step 6: Build + commit

```bash
cd studio-plugin && npx rbxtsc && cd ..
npm run build && npm run build:plugin
git add -A
git commit -m "feat: add VFXHandlers — create_light, create_particle_effect"
```

---

## Task 7: VFX — `create_beam` + `create_trail`

**Files:**
- Modify: `studio-plugin/src/modules/handlers/VFXHandlers.ts`
- Modify: `packages/core/src/tools/definitions.ts`
- Modify: `packages/core/src/tools/index.ts`
- Modify: `packages/core/src/http-server.ts`
- Modify: `studio-plugin/src/modules/Communication.ts`

### Step 1: Ajouter `createBeam` et `createTrail` dans `VFXHandlers.ts`

Avant la ligne `export = { ... }` :

```typescript
function createBeam(requestData: Record<string, unknown>) {
	const att0Path = requestData.attachment0 as string;
	const att1Path = requestData.attachment1 as string;
	const parentPath = (requestData.parent as string) ?? att0Path;

	if (!att0Path || !att1Path) return { error: "attachment0 and attachment1 paths are required" };

	const att0 = getInstanceByPath(att0Path);
	const att1 = getInstanceByPath(att1Path);
	if (!att0) return { error: `attachment0 not found: ${att0Path}` };
	if (!att1) return { error: `attachment1 not found: ${att1Path}` };
	const parentInst = getInstanceByPath(parentPath) ?? att0;

	const recordingId = beginRecording("Create Beam");
	const [success, beam] = pcall(() => {
		const b = new Instance("Beam");
		b.Attachment0 = att0 as Attachment;
		b.Attachment1 = att1 as Attachment;
		if (requestData.width !== undefined) {
			const w = requestData.width as number;
			b.Width0 = w;
			b.Width1 = w;
		}
		if (requestData.color !== undefined) {
			b.Color = buildColorSequence(requestData.color as Array<{ time: number; rgb: number[] }>);
		}
		if (requestData.transparency !== undefined) {
			b.Transparency = buildNumberSequence(requestData.transparency as Array<{ time: number; value: number }>);
		}
		if (requestData.lightEmission !== undefined) b.LightEmission = requestData.lightEmission as number;
		if (requestData.texture !== undefined) b.Texture = requestData.texture as string;
		b.Parent = parentInst;
		return b;
	});
	finishRecording(recordingId, success);

	if (success && beam) return { success: true, path: getInstancePath(beam as Instance) };
	return { error: `Failed to create Beam: ${tostring(beam)}` };
}

function createTrail(requestData: Record<string, unknown>) {
	const parentPath = requestData.parent as string;
	if (!parentPath) return { error: "parent is required" };
	const parentInst = getInstanceByPath(parentPath);
	if (!parentInst) return { error: `Parent not found: ${parentPath}` };

	const recordingId = beginRecording("Create Trail");
	const [success, result] = pcall(() => {
		const att0 = new Instance("Attachment");
		att0.Name = "TrailAttachment0";
		att0.Parent = parentInst;

		const att1 = new Instance("Attachment");
		att1.Name = "TrailAttachment1";
		att1.Position = new Vector3(0, (requestData.attachmentOffset as number | undefined) ?? 1, 0);
		att1.Parent = parentInst;

		const t = new Instance("Trail");
		t.Attachment0 = att0;
		t.Attachment1 = att1;
		if (requestData.lifetime !== undefined) t.Lifetime = requestData.lifetime as number;
		if (requestData.minLength !== undefined) t.MinLength = requestData.minLength as number;
		if (requestData.color !== undefined) {
			t.Color = buildColorSequence(requestData.color as Array<{ time: number; rgb: number[] }>);
		}
		if (requestData.transparency !== undefined) {
			t.Transparency = buildNumberSequence(requestData.transparency as Array<{ time: number; value: number }>);
		}
		if (requestData.widthScale !== undefined) {
			t.WidthScale = buildNumberSequence(requestData.widthScale as Array<{ time: number; value: number }>);
		}
		if (requestData.lightEmission !== undefined) t.LightEmission = requestData.lightEmission as number;
		if (requestData.texture !== undefined) t.Texture = requestData.texture as string;
		t.Parent = parentInst;
		return { trail: t, att0, att1 };
	});
	finishRecording(recordingId, success);

	if (success && result) {
		const r = result as { trail: Instance; att0: Instance; att1: Instance };
		return {
			success: true,
			trailPath: getInstancePath(r.trail),
			attachment0Path: getInstancePath(r.att0),
			attachment1Path: getInstancePath(r.att1),
		};
	}
	return { error: `Failed to create Trail: ${tostring(result)}` };
}
```

Mettre à jour `export = { createLight, createParticleEffect, createBeam, createTrail, buildColorSequence, buildNumberSequence }`.

### Step 2: Ajouter définitions dans `definitions.ts`

```typescript
{
  name: 'create_beam',
  description: 'Create a Beam between two Attachments',
  inputSchema: {
    type: 'object',
    properties: {
      attachment0: { type: 'string', description: 'Path to first Attachment' },
      attachment1: { type: 'string', description: 'Path to second Attachment' },
      parent: { type: 'string', description: 'Parent for the Beam (defaults to attachment0 parent)' },
      width: { type: 'number', description: 'Beam width (Width0 = Width1)' },
      color: { type: 'array', description: 'ColorSequence [{time, rgb}]', items: { type: 'object', additionalProperties: true } },
      transparency: { type: 'array', description: 'NumberSequence [{time, value}]', items: { type: 'object', additionalProperties: true } },
      lightEmission: { type: 'number', description: '0-1' },
      texture: { type: 'string', description: 'rbxassetid://...' },
    },
    required: ['attachment0', 'attachment1'],
  },
},
{
  name: 'create_trail',
  description: 'Create a Trail on a BasePart (auto-creates two Attachments)',
  inputSchema: {
    type: 'object',
    properties: {
      parent: { type: 'string', description: 'Parent BasePart path' },
      lifetime: { type: 'number', description: 'Trail lifetime in seconds' },
      minLength: { type: 'number', description: 'Minimum segment length' },
      attachmentOffset: { type: 'number', description: 'Y offset between the two auto-created attachments (default: 1)' },
      color: { type: 'array', description: 'ColorSequence [{time, rgb}]', items: { type: 'object', additionalProperties: true } },
      transparency: { type: 'array', description: 'NumberSequence [{time, value}]', items: { type: 'object', additionalProperties: true } },
      widthScale: { type: 'array', description: 'NumberSequence [{time, value}]', items: { type: 'object', additionalProperties: true } },
      lightEmission: { type: 'number' },
      texture: { type: 'string' },
    },
    required: ['parent'],
  },
},
```

### Step 3: Ajouter méthodes dans `index.ts`

```typescript
async createBeam(attachment0: string, attachment1: string, options?: Record<string, unknown>) {
  const response = await this.client.request('/api/create-beam', { attachment0, attachment1, ...options });
  return { content: [{ type: 'text', text: JSON.stringify(response) }] };
}

async createTrail(parent: string, options?: Record<string, unknown>) {
  const response = await this.client.request('/api/create-trail', { parent, ...options });
  return { content: [{ type: 'text', text: JSON.stringify(response) }] };
}
```

### Step 4: Ajouter dans `TOOL_HANDLERS`

```typescript
create_beam: (tools, body) => tools.createBeam(body.attachment0, body.attachment1, body),
create_trail: (tools, body) => tools.createTrail(body.parent, body),
```

### Step 5: Ajouter routes dans `Communication.ts`

```typescript
"/api/create-beam": VFXHandlers.createBeam,
"/api/create-trail": VFXHandlers.createTrail,
```

### Step 6: Build + commit

```bash
cd studio-plugin && npx rbxtsc && cd ..
npm run build && npm run build:plugin
git add -A
git commit -m "feat: add VFX beam and trail tools"
```

---

## Task 8: VFX — `set_post_processing` + `create_vfx_preset`

**Files:**
- Modify: `studio-plugin/src/modules/handlers/VFXHandlers.ts`
- Modify: `packages/core/src/tools/definitions.ts`
- Modify: `packages/core/src/tools/index.ts`
- Modify: `packages/core/src/http-server.ts`
- Modify: `studio-plugin/src/modules/Communication.ts`

### Step 1: Ajouter `setPostProcessing` et `createVfxPreset` dans `VFXHandlers.ts`

```typescript
const LightingService = game.GetService("Lighting");

function getOrCreate<T extends Instance>(className: string): T {
	const existing = LightingService.FindFirstChildOfClass(className as keyof Instances);
	if (existing) return existing as T;
	const inst = new Instance(className as keyof CreatableInstances);
	inst.Parent = LightingService;
	return inst as T;
}

function setPostProcessing(requestData: Record<string, unknown>) {
	const recordingId = beginRecording("Set post-processing effects");
	const created: string[] = [];

	const [success, err] = pcall(() => {
		if (requestData.bloom) {
			const b = requestData.bloom as Record<string, number>;
			const bloom = getOrCreate<BloomEffect>("BloomEffect");
			if (b.intensity !== undefined) bloom.Intensity = b.intensity;
			if (b.size !== undefined) bloom.Size = b.size;
			if (b.threshold !== undefined) bloom.Threshold = b.threshold;
			created.push("BloomEffect");
		}
		if (requestData.colorCorrection) {
			const c = requestData.colorCorrection as Record<string, unknown>;
			const cc = getOrCreate<ColorCorrectionEffect>("ColorCorrectionEffect");
			if (c.saturation !== undefined) cc.Saturation = c.saturation as number;
			if (c.contrast !== undefined) cc.Contrast = c.contrast as number;
			if (c.tintColor !== undefined) {
				const tc = c.tintColor as number[];
				cc.TintColor = Color3.fromRGB(tc[0] ?? 255, tc[1] ?? 255, tc[2] ?? 255);
			}
			created.push("ColorCorrectionEffect");
		}
		if (requestData.sunRays) {
			const s = requestData.sunRays as Record<string, number>;
			const sr = getOrCreate<SunRaysEffect>("SunRaysEffect");
			if (s.intensity !== undefined) sr.Intensity = s.intensity;
			if (s.spread !== undefined) sr.Spread = s.spread;
			created.push("SunRaysEffect");
		}
		if (requestData.depthOfField) {
			const d = requestData.depthOfField as Record<string, number>;
			const dof = getOrCreate<DepthOfFieldEffect>("DepthOfFieldEffect");
			if (d.farIntensity !== undefined) dof.FarIntensity = d.farIntensity;
			if (d.focusDistance !== undefined) dof.FocusDistance = d.focusDistance;
			if (d.inFocusRadius !== undefined) dof.InFocusRadius = d.inFocusRadius;
			created.push("DepthOfFieldEffect");
		}
		if (requestData.blur) {
			const b = requestData.blur as Record<string, number>;
			const blur = getOrCreate<BlurEffect>("BlurEffect");
			if (b.size !== undefined) blur.Size = b.size;
			created.push("BlurEffect");
		}
	});
	finishRecording(recordingId, success);

	if (success) return { success: true, effects: created };
	return { error: `Failed to set post-processing: ${tostring(err)}` };
}

function createVfxPreset(requestData: Record<string, unknown>) {
	const preset = requestData.preset as string;
	const targetPath = requestData.target as string;
	const scale = (requestData.scale as number | undefined) ?? 1;
	const colorRaw = requestData.color as number[] | undefined;

	if (!preset || !targetPath) return { error: "preset and target are required" };
	const validPresets = ["explosion", "fire", "magic_aura", "hit_effect", "smoke"];
	if (!validPresets.includes(preset)) {
		return { error: `Unknown preset: ${preset}. Valid: ${validPresets.join(", ")}` };
	}

	const targetInst = getInstanceByPath(targetPath);
	if (!targetInst) return { error: `Target not found: ${targetPath}` };

	const c = colorRaw ?? [255, 150, 0];
	const mainColor = Color3.fromRGB(c[0] ?? 255, c[1] ?? 150, c[2] ?? 0);
	const created: string[] = [];
	const recordingId = beginRecording(`VFX preset: ${preset}`);

	const [success, err] = pcall(() => {
		if (preset === "explosion") {
			const light = new Instance("PointLight");
			light.Brightness = 20 * scale;
			light.Range = 30 * scale;
			light.Color = mainColor;
			light.Parent = targetInst;
			created.push(getInstancePath(light));

			const burst = new Instance("ParticleEmitter");
			burst.Name = "ExplosionBurst";
			burst.Rate = 500;
			burst.Lifetime = new NumberRange(0.1 * scale, 0.3 * scale);
			burst.Speed = new NumberRange(10 * scale, 30 * scale);
			burst.Color = new ColorSequence(mainColor);
			burst.LightEmission = 0.8;
			burst.Parent = targetInst;
			created.push(getInstancePath(burst));

			const smoke = new Instance("ParticleEmitter");
			smoke.Name = "ExplosionSmoke";
			smoke.Rate = 20;
			smoke.Lifetime = new NumberRange(1 * scale, 2 * scale);
			smoke.Speed = new NumberRange(2, 5);
			smoke.Color = new ColorSequence(Color3.fromRGB(100, 100, 100));
			smoke.Parent = targetInst;
			created.push(getInstancePath(smoke));

		} else if (preset === "fire") {
			const fire = new Instance("Fire");
			(fire as unknown as { Size: number }).Size = 5 * scale;
			(fire as unknown as { Heat: number }).Heat = 9 * scale;
			(fire as unknown as { Color: Color3 }).Color = mainColor;
			fire.Parent = targetInst;
			created.push(getInstancePath(fire));

			const smokeInst = new Instance("Smoke");
			(smokeInst as unknown as { RiseVelocity: number }).RiseVelocity = 4;
			(smokeInst as unknown as { Density: number }).Density = 0.3;
			smokeInst.Parent = targetInst;
			created.push(getInstancePath(smokeInst));

		} else if (preset === "magic_aura") {
			const aura = new Instance("ParticleEmitter");
			aura.Name = "MagicAura";
			aura.Rate = 30 * scale;
			aura.Lifetime = new NumberRange(0.5, 1.5);
			aura.Speed = new NumberRange(1, 3);
			aura.SpreadAngle = new Vector2(360, 360);
			aura.Color = new ColorSequence(mainColor);
			aura.LightEmission = 0.6;
			aura.Parent = targetInst;
			created.push(getInstancePath(aura));

			const light2 = new Instance("PointLight");
			light2.Color = mainColor;
			light2.Brightness = 3 * scale;
			light2.Range = 10 * scale;
			light2.Parent = targetInst;
			created.push(getInstancePath(light2));

		} else if (preset === "hit_effect") {
			const hit = new Instance("ParticleEmitter");
			hit.Name = "HitEffect";
			hit.Rate = 1000;
			hit.Lifetime = new NumberRange(0.05, 0.15);
			hit.Speed = new NumberRange(5 * scale, 15 * scale);
			hit.SpreadAngle = new Vector2(180, 180);
			hit.Color = new ColorSequence(mainColor);
			hit.LightEmission = 1;
			hit.Parent = targetInst;
			created.push(getInstancePath(hit));

			const flash = new Instance("PointLight");
			flash.Color = mainColor;
			flash.Brightness = 10 * scale;
			flash.Range = 15 * scale;
			flash.Parent = targetInst;
			created.push(getInstancePath(flash));

		} else if (preset === "smoke") {
			const nativeSmoke = new Instance("Smoke");
			(nativeSmoke as unknown as { RiseVelocity: number }).RiseVelocity = 3 * scale;
			(nativeSmoke as unknown as { Density: number }).Density = 0.5;
			(nativeSmoke as unknown as { Color: Color3 }).Color = Color3.fromRGB(180, 180, 180);
			nativeSmoke.Parent = targetInst;
			created.push(getInstancePath(nativeSmoke));

			const smokeParticles = new Instance("ParticleEmitter");
			smokeParticles.Name = "SmokeParticles";
			smokeParticles.Rate = 5 * scale;
			smokeParticles.Lifetime = new NumberRange(2, 4);
			smokeParticles.Speed = new NumberRange(1, 3);
			smokeParticles.Color = new ColorSequence(Color3.fromRGB(160, 160, 160));
			smokeParticles.LightInfluence = 1;
			smokeParticles.Parent = targetInst;
			created.push(getInstancePath(smokeParticles));
		}
	});
	finishRecording(recordingId, success);

	if (success) return { success: true, preset, target: targetPath, created };
	return { error: `Failed to create VFX preset: ${tostring(err)}` };
}
```

Mettre à jour `export = { ..., setPostProcessing, createVfxPreset }`.

### Step 2: Ajouter définitions dans `definitions.ts`

```typescript
{
  name: 'set_post_processing',
  description: 'Create or update post-processing effects in game.Lighting (Bloom, ColorCorrection, SunRays, DepthOfField, Blur)',
  inputSchema: {
    type: 'object',
    properties: {
      bloom: {
        type: 'object',
        description: '{ intensity?: number, size?: number, threshold?: number }',
        additionalProperties: true,
      },
      colorCorrection: {
        type: 'object',
        description: '{ saturation?: number, contrast?: number, tintColor?: [r,g,b] }',
        additionalProperties: true,
      },
      sunRays: {
        type: 'object',
        description: '{ intensity?: number, spread?: number }',
        additionalProperties: true,
      },
      depthOfField: {
        type: 'object',
        description: '{ farIntensity?: number, focusDistance?: number, inFocusRadius?: number }',
        additionalProperties: true,
      },
      blur: {
        type: 'object',
        description: '{ size?: number }',
        additionalProperties: true,
      },
    },
  },
},
{
  name: 'create_vfx_preset',
  description: 'Create a complete named VFX preset in one call. Presets: explosion, fire, magic_aura, hit_effect, smoke',
  inputSchema: {
    type: 'object',
    properties: {
      preset: { type: 'string', description: '"explosion" | "fire" | "magic_aura" | "hit_effect" | "smoke"' },
      target: { type: 'string', description: 'Target instance path (e.g. "Workspace.HitPart")' },
      scale: { type: 'number', description: 'Global scale multiplier (default: 1)' },
      color: { type: 'array', items: { type: 'number' }, description: '[r, g, b] 0-255 main color (default: orange)' },
    },
    required: ['preset', 'target'],
  },
},
```

### Step 3: Ajouter méthodes dans `index.ts`

```typescript
async setPostProcessing(effects: Record<string, unknown>) {
  const response = await this.client.request('/api/set-post-processing', effects);
  return { content: [{ type: 'text', text: JSON.stringify(response) }] };
}

async createVfxPreset(preset: string, target: string, scale?: number, color?: number[]) {
  const response = await this.client.request('/api/create-vfx-preset', { preset, target, scale, color });
  return { content: [{ type: 'text', text: JSON.stringify(response) }] };
}
```

### Step 4: Ajouter dans `TOOL_HANDLERS`

```typescript
set_post_processing: (tools, body) => tools.setPostProcessing(body),
create_vfx_preset: (tools, body) => tools.createVfxPreset(body.preset, body.target, body.scale, body.color),
```

### Step 5: Ajouter routes dans `Communication.ts`

```typescript
"/api/set-post-processing": VFXHandlers.setPostProcessing,
"/api/create-vfx-preset": VFXHandlers.createVfxPreset,
```

### Step 6: Build + commit

```bash
cd studio-plugin && npx rbxtsc && cd ..
npm run build && npm run build:plugin
git add -A
git commit -m "feat: add VFX set_post_processing and create_vfx_preset"
```

---

## Task 9: `AudioHandlers.ts` — `create_sound`

**Files:**
- Create: `studio-plugin/src/modules/handlers/AudioHandlers.ts`
- Modify: `packages/core/src/tools/definitions.ts`
- Modify: `packages/core/src/tools/index.ts`
- Modify: `packages/core/src/http-server.ts`
- Modify: `studio-plugin/src/modules/Communication.ts`

### Step 1: Créer `AudioHandlers.ts`

```typescript
import Utils from "../Utils";
import Recording from "../Recording";

const { getInstancePath, getInstanceByPath } = Utils;
const { beginRecording, finishRecording } = Recording;

function createSound(requestData: Record<string, unknown>) {
	const parentPath = requestData.parent as string;
	if (!parentPath) return { error: "parent is required" };

	const parentInst = getInstanceByPath(parentPath);
	if (!parentInst) return { error: `Parent not found: ${parentPath}` };

	const recordingId = beginRecording("Create Sound");
	const [success, sound] = pcall(() => {
		const s = new Instance("Sound");
		if (requestData.soundId) s.SoundId = requestData.soundId as string;
		if (requestData.name) s.Name = requestData.name as string;
		if (requestData.volume !== undefined) s.Volume = requestData.volume as number;
		if (requestData.looped !== undefined) s.Looped = requestData.looped as boolean;
		if (requestData.rollOffMaxDistance !== undefined) {
			(s as unknown as { RollOffMaxDistance: number }).RollOffMaxDistance = requestData.rollOffMaxDistance as number;
		}
		if (requestData.pitch !== undefined) s.PlaybackSpeed = requestData.pitch as number;
		s.Parent = parentInst;
		return s;
	});
	finishRecording(recordingId, success);

	if (success && sound) {
		const s = sound as Sound;
		return { success: true, path: getInstancePath(s), soundId: s.SoundId };
	}
	return { error: `Failed to create Sound: ${tostring(sound)}` };
}

export = { createSound };
```

### Step 2: Ajouter définition dans `definitions.ts`

```typescript
{
  name: 'create_sound',
  description: 'Create a Sound instance with full configuration',
  inputSchema: {
    type: 'object',
    properties: {
      parent: { type: 'string', description: 'Parent instance path' },
      soundId: { type: 'string', description: 'rbxassetid://... sound asset ID' },
      name: { type: 'string', description: 'Name for the Sound instance' },
      volume: { type: 'number', description: '0-1 (default: 0.5)' },
      looped: { type: 'boolean', description: 'Whether the sound loops' },
      rollOffMaxDistance: { type: 'number', description: 'Max distance for 3D audio falloff' },
      pitch: { type: 'number', description: 'Pitch multiplier via PlaybackSpeed (default: 1)' },
    },
    required: ['parent'],
  },
},
```

### Step 3: Ajouter méthode dans `index.ts`

```typescript
async createSound(parent: string, options?: Record<string, unknown>) {
  const response = await this.client.request('/api/create-sound', { parent, ...options });
  return { content: [{ type: 'text', text: JSON.stringify(response) }] };
}
```

### Step 4: Ajouter dans `TOOL_HANDLERS`

```typescript
create_sound: (tools, body) => tools.createSound(body.parent, body),
```

### Step 5: Ajouter import + route dans `Communication.ts`

```typescript
import AudioHandlers from "./handlers/AudioHandlers";
// dans routeMap:
"/api/create-sound": AudioHandlers.createSound,
```

### Step 6: Build + commit

```bash
cd studio-plugin && npx rbxtsc && cd ..
npm run build && npm run build:plugin
git add -A
git commit -m "feat: add AudioHandlers — create_sound"
```

---

## Task 10: Script tools — `get_all_scripts` + `find_references` + `execute_luau_wait`

**Files:**
- Modify: `studio-plugin/src/modules/handlers/ScriptHandlers.ts`
- Modify: `packages/core/src/tools/definitions.ts`
- Modify: `packages/core/src/tools/index.ts`
- Modify: `packages/core/src/http-server.ts`
- Modify: `studio-plugin/src/modules/Communication.ts`

### Step 1: Lire `ScriptHandlers.ts` pour voir les imports existants

```bash
# Lire le fichier avant de modifier
```

### Step 2: Ajouter 3 fonctions dans `ScriptHandlers.ts`

Avant `export = { ... }` :

```typescript
function getAllScripts(requestData: Record<string, unknown>) {
	const includeSource = requestData.includeSource !== false;
	const results: Record<string, unknown>[] = [];

	const [success, err] = pcall(() => {
		for (const desc of game.GetDescendants()) {
			if (desc.IsA("LuaSourceContainer")) {
				const entry: Record<string, unknown> = {
					path: getInstancePath(desc),
					name: desc.Name,
					className: desc.ClassName,
				};
				if (includeSource) {
					const [ok, src] = pcall(() => (desc as unknown as { Source: string }).Source);
					entry.source = ok ? src : "[unreadable]";
				}
				results.push(entry);
			}
		}
	});

	if (!success) return { error: tostring(err) };
	return { count: results.size(), scripts: results };
}

function findReferences(requestData: Record<string, unknown>) {
	const query = requestData.query as string;
	if (!query) return { error: "query is required" };

	const results: Record<string, unknown>[] = [];
	const [success, err] = pcall(() => {
		for (const desc of game.GetDescendants()) {
			if (desc.IsA("LuaSourceContainer")) {
				const [ok, source] = pcall(() => (desc as unknown as { Source: string }).Source);
				if (ok && source) {
					if ((source as string).find(query)[0] !== undefined) {
						results.push({
							path: getInstancePath(desc),
							name: desc.Name,
							className: desc.ClassName,
						});
					}
				}
			}
		}
	});

	if (!success) return { error: tostring(err) };
	return { query, count: results.size(), references: results };
}

function executeLuauWait(requestData: Record<string, unknown>) {
	const code = requestData.code as string;
	if (!code) return { error: "code is required" };

	const wrappedCode = `return (function()\n${code}\nend)()`;
	const [loadOk, fn] = loadstring(wrappedCode) as LuaTuple<[(() => unknown) | undefined, string | undefined]>;

	if (!loadOk || !fn) {
		return { error: `Syntax error: ${tostring(fn)}` };
	}

	const [runOk, result] = pcall(fn);
	if (!runOk) return { error: `Runtime error: ${tostring(result)}` };

	// Attempt JSON serialization
	const HttpSvc = game.GetService("HttpService");
	const [serOk, serialized] = pcall(() => HttpSvc.JSONEncode(result));
	const finalResult = serOk ? result : tostring(result);

	return { success: true, result: finalResult };
}
```

Ajouter `getAllScripts`, `findReferences`, `executeLuauWait` dans `export = { ... }`.

### Step 3: Ajouter 3 définitions dans `definitions.ts`

```typescript
{
  name: 'get_all_scripts',
  description: 'Get all scripts in the game with their paths and optionally their source code',
  inputSchema: {
    type: 'object',
    properties: {
      includeSource: { type: 'boolean', description: 'Include script source code (default: true)' },
    },
  },
},
{
  name: 'find_references',
  description: 'Find all scripts that reference (contain) a given string (module name, function, pattern)',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'String to search for in script sources' },
    },
    required: ['query'],
  },
},
{
  name: 'execute_luau_wait',
  description: 'Execute Luau code and wait for the return value (unlike execute_luau which is fire-and-forget)',
  inputSchema: {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'Luau code to execute. Use "return" to return a value.' },
    },
    required: ['code'],
  },
},
```

### Step 4: Ajouter méthodes dans `index.ts`

```typescript
async getAllScripts(includeSource?: boolean) {
  const response = await this.client.request('/api/get-all-scripts', { includeSource });
  return { content: [{ type: 'text', text: JSON.stringify(response) }] };
}

async findReferences(query: string) {
  const response = await this.client.request('/api/find-references', { query });
  return { content: [{ type: 'text', text: JSON.stringify(response) }] };
}

async executeLuauWait(code: string) {
  const response = await this.client.request('/api/execute-luau-wait', { code });
  return { content: [{ type: 'text', text: JSON.stringify(response) }] };
}
```

### Step 5: Ajouter dans `TOOL_HANDLERS`

```typescript
get_all_scripts: (tools, body) => tools.getAllScripts(body.includeSource),
find_references: (tools, body) => tools.findReferences(body.query),
execute_luau_wait: (tools, body) => tools.executeLuauWait(body.code),
```

### Step 6: Ajouter routes dans `Communication.ts`

```typescript
"/api/get-all-scripts": ScriptHandlers.getAllScripts,
"/api/find-references": ScriptHandlers.findReferences,
"/api/execute-luau-wait": ScriptHandlers.executeLuauWait,
```

### Step 7: Build + commit

```bash
cd studio-plugin && npx rbxtsc && cd ..
npm run build && npm run build:plugin
git add -A
git commit -m "feat: add script tools — get_all_scripts, find_references, execute_luau_wait"
```

---

## Task 11: Camera tools — `get_camera` + `set_camera`

**Files:**
- Modify: `studio-plugin/src/modules/handlers/MetadataHandlers.ts`
- Modify: `packages/core/src/tools/definitions.ts`
- Modify: `packages/core/src/tools/index.ts`
- Modify: `packages/core/src/http-server.ts`
- Modify: `studio-plugin/src/modules/Communication.ts`

### Step 1: Ajouter 2 fonctions dans `MetadataHandlers.ts`

```typescript
function getCamera(_requestData: Record<string, unknown>) {
	const camera = game.Workspace.CurrentCamera;
	if (!camera) return { error: "No camera found" };

	const cf = camera.CFrame;
	const pos = cf.Position;
	const lookVec = cf.LookVector;

	return {
		success: true,
		position: [pos.X, pos.Y, pos.Z],
		lookVector: [lookVec.X, lookVec.Y, lookVec.Z],
		fov: camera.FieldOfView,
		cameraType: tostring(camera.CameraType),
	};
}

function setCamera(requestData: Record<string, unknown>) {
	const camera = game.Workspace.CurrentCamera;
	if (!camera) return { error: "No camera found" };

	const posRaw = requestData.position as number[] | undefined;
	const lookAtRaw = requestData.lookAt as number[] | undefined;

	const recordingId = beginRecording("Set camera");
	const [success, err] = pcall(() => {
		if (posRaw) {
			const pos = new Vector3(posRaw[0] ?? 0, posRaw[1] ?? 0, posRaw[2] ?? 0);
			if (lookAtRaw) {
				const lookAt = new Vector3(lookAtRaw[0] ?? 0, lookAtRaw[1] ?? 0, lookAtRaw[2] ?? 0);
				camera.CFrame = CFrame.lookAt(pos, lookAt);
			} else {
				camera.CFrame = new CFrame(pos);
			}
		}
		if (requestData.fov !== undefined) camera.FieldOfView = requestData.fov as number;
	});
	finishRecording(recordingId, success);

	if (success) {
		const p = camera.CFrame.Position;
		return { success: true, position: [p.X, p.Y, p.Z], fov: camera.FieldOfView };
	}
	return { error: `Failed to set camera: ${tostring(err)}` };
}
```

Ajouter `getCamera` et `setCamera` dans `export = { ... }`.

### Step 2: Ajouter définitions dans `definitions.ts`

```typescript
{
  name: 'get_camera',
  description: 'Get current Studio camera position, look vector, and FOV',
  inputSchema: { type: 'object', properties: {} },
},
{
  name: 'set_camera',
  description: 'Move the Studio camera to a position, optionally looking at a target',
  inputSchema: {
    type: 'object',
    properties: {
      position: { type: 'array', items: { type: 'number' }, description: '[x, y, z] camera position' },
      lookAt: { type: 'array', items: { type: 'number' }, description: '[x, y, z] point to look at (optional)' },
      fov: { type: 'number', description: 'Field of view in degrees (optional)' },
    },
  },
},
```

### Step 3: Ajouter méthodes dans `index.ts`

```typescript
async getCamera() {
  const response = await this.client.request('/api/get-camera', {});
  return { content: [{ type: 'text', text: JSON.stringify(response) }] };
}

async setCamera(position?: number[], lookAt?: number[], fov?: number) {
  const response = await this.client.request('/api/set-camera', { position, lookAt, fov });
  return { content: [{ type: 'text', text: JSON.stringify(response) }] };
}
```

### Step 4: Ajouter dans `TOOL_HANDLERS`

```typescript
get_camera: (tools) => tools.getCamera(),
set_camera: (tools, body) => tools.setCamera(body.position, body.lookAt, body.fov),
```

### Step 5: Ajouter routes dans `Communication.ts`

```typescript
"/api/get-camera": MetadataHandlers.getCamera,
"/api/set-camera": MetadataHandlers.setCamera,
```

### Step 6: Build + commit

```bash
cd studio-plugin && npx rbxtsc && cd ..
npm run build && npm run build:plugin
git add -A
git commit -m "feat: add camera tools — get_camera, set_camera"
```

---

## Task 12: Final build, tests + vérification

### Step 1: Build complet propre

```bash
cd E:/Roblox/robloxstudio-mcp
npm run build
```

Attendu : zéro erreur TypeScript.

### Step 2: Build plugin propre

```bash
cd studio-plugin && npx rbxtsc && cd ..
npm run build:plugin
```

Attendu : zéro erreur roblox-ts, fichier `.rbxm` généré.

### Step 3: Lancer les tests

```bash
npm test
```

Attendu : tous les tests existants passent.

### Step 4: Vérifier le nombre de tools dans `TOOL_DEFINITIONS`

```bash
grep -c "name:" packages/core/src/tools/definitions.ts
```

Attendu : le compte a augmenté de 21 (1 batch_execute + 20 nouveaux tools).

### Step 5: Vérifier le nombre de routes dans `TOOL_HANDLERS`

```bash
grep -c "_:" packages/core/src/http-server.ts
```

Vérifier visuellement que tous les nouveaux tools sont dans `TOOL_HANDLERS`.

### Step 6: Vérifier le routeMap du plugin

```bash
grep -c '"/api/' studio-plugin/src/modules/Communication.ts
```

Vérifier que toutes les nouvelles routes `/api/...` sont présentes.

### Step 7: Commit final

```bash
git add -A
git commit -m "chore: final build verification — 21 new tools complete"
```

---

## Récapitulatif des fichiers modifiés

| Fichier | Changements |
|---------|-------------|
| `packages/core/src/tools/definitions.ts` | +21 tool definitions |
| `packages/core/src/tools/index.ts` | +21 méthodes dans RobloxStudioTools |
| `packages/core/src/http-server.ts` | +21 entrées dans TOOL_HANDLERS |
| `studio-plugin/src/modules/Communication.ts` | +batchExecute + +20 routes dans routeMap |
| `studio-plugin/src/modules/handlers/InstanceHandlers.ts` | +moveObject, renameObject, cloneInstance, getDescendantsByClass |
| `studio-plugin/src/modules/handlers/PropertyHandlers.ts` | +setMultipleProperties |
| `studio-plugin/src/modules/handlers/MetadataHandlers.ts` | +getContext, getDeepSnapshot, getCamera, setCamera |
| `studio-plugin/src/modules/handlers/ScriptHandlers.ts` | +getAllScripts, findReferences, executeLuauWait |
| `studio-plugin/src/modules/handlers/VFXHandlers.ts` | **NOUVEAU** — 6 tools VFX |
| `studio-plugin/src/modules/handlers/AudioHandlers.ts` | **NOUVEAU** — createSound |

## Critères de succès

- `npm run build` sans erreur
- `cd studio-plugin && npx rbxtsc` sans erreur
- `npm test` tous les tests existants passent
- `batch_execute` avec 5 opérations s'exécute en 1 seul round-trip HTTP
- `create_vfx_preset("explosion", "Workspace.Part")` crée le VFX complet en 1 appel MCP
