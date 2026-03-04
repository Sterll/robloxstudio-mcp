# Design : Batch Execute + VFX + Tools Expansion

**Date :** 2026-03-04
**Statut :** Approuvé
**Approche retenue :** B — batch_execute fondation + nouveaux tools

---

## Contexte

Le MCP robloxstudio dispose de 40+ outils. Deux problèmes :
1. **Performance** : chaque tool = 1 round-trip HTTP. Créer un VFX complet = 10-15 appels séquentiels = 150-500ms de latence cumulée.
2. **Features manquantes** : pas de VFX natif, pas de move/rename, pas de snapshot rapide, pas de camera control, pas d'audio.

---

## Architecture : `batch_execute`

Un seul tool qui envoie N opérations en **un round-trip** et retourne N résultats.

```json
{
  "operations": [
    { "tool": "create_object", "args": { "className": "ParticleEmitter", "parent": "Workspace.HitPart" } },
    { "tool": "set_multiple_properties", "args": { "instancePath": "Workspace.HitPart.ParticleEmitter", "properties": { "Rate": 100, "Lifetime": 1 } } },
    { "tool": "create_light", "args": { "type": "PointLight", "parent": "Workspace.HitPart", "brightness": 5 } }
  ]
}
```

Retourne :
```json
{
  "results": [
    { "success": true, "path": "Workspace.HitPart.ParticleEmitter" },
    { "success": true },
    { "success": true, "path": "Workspace.HitPart.PointLight" }
  ],
  "allSucceeded": true
}
```

**Côté serveur** (`http-server.ts`) : handler `/mcp/batch_execute` qui fan-out vers les handlers existants en séquentiel.
**Côté plugin** (`Communication.ts`) : endpoint `/api/batch-execute` qui itère sur les opérations, appelle `processRequest` pour chacune, et retourne le tableau de résultats.
**Aucun refactor** des tools existants — compatibilité totale.

---

## Nouveaux Tools

### Catégorie : Hiérarchie

| Tool | Description |
|------|-------------|
| `move_object` | Reparente une instance vers un nouveau parent |
| `rename_object` | Renomme une instance (set Name) |
| `clone_instance` | Clone une instance vers un parent, avec position optionnelle |
| `get_descendants_by_class` | Retourne tous les descendants d'une classe donnée sous un chemin |
| `set_multiple_properties` | Set N propriétés sur 1 objet en 1 appel |

### Catégorie : Scripts

| Tool | Description |
|------|-------------|
| `get_all_scripts` | Tous les scripts du jeu (path + source) en un appel |
| `find_references` | Trouve qui `require()` ou appelle un module donné |
| `execute_luau_wait` | Exécute du Luau et attend la valeur de retour (vs `execute_luau` qui est fire-and-forget) |

### Catégorie : VFX

| Tool | Description |
|------|-------------|
| `create_particle_effect` | ParticleEmitter complet avec ColorSequence/NumberSequence |
| `create_beam` | Beam entre deux Attachments |
| `create_trail` | Trail sur un BasePart |
| `create_light` | PointLight / SpotLight / SurfaceLight |
| `set_post_processing` | Bloom, ColorCorrection, SunRays, DepthOfField dans Lighting |
| `create_vfx_preset` | Preset nommé complet (explosion, fire, magic_aura, hit_effect, smoke) |

### Catégorie : Audio

| Tool | Description |
|------|-------------|
| `create_sound` | Crée un Sound complet (SoundId, Volume, Looped, RollOffMaxDistance) |

### Catégorie : Camera

| Tool | Description |
|------|-------------|
| `get_camera` | Position + orientation caméra Studio actuelle |
| `set_camera` | Déplace la caméra vers une position/CFrame |

### Catégorie : Context / Snapshot

| Tool | Description |
|------|-------------|
| `get_context` | Snapshot rapide : objet sélectionné + nom jeu + services + nb scripts |
| `get_deep_snapshot` | Subtree complet d'un objet (enfants + properties) récursif en 1 appel |

---

## VFX System — Détail

### `create_particle_effect`

Schema simplifié pour Claude — le plugin construit les types Roblox complexes :

```typescript
{
  parent: string,
  name?: string,
  rate?: number,                          // particles/sec
  lifetime?: [min: number, max: number],
  speed?: [min: number, max: number],
  color?: Array<{time: number, rgb: [r,g,b]}>,   // → ColorSequence
  size?: Array<{time: number, value: number}>,    // → NumberSequence
  transparency?: Array<{time: number, value: number}>,
  spreadAngle?: [x: number, y: number],
  lightEmission?: number,                  // 0-1
  lightInfluence?: number,                 // 0-1
  texture?: string,                        // rbxassetid://...
  rotSpeed?: [min: number, max: number],
  rotation?: [min: number, max: number],
  acceleration?: [x: number, y: number, z: number],
  enabled?: boolean,
  emissionDirection?: string,              // "Top"|"Bottom"|"Front"|etc.
}
```

### `create_vfx_preset`

Presets définis côté plugin en Luau — zéro round-trip supplémentaire car tout se passe dans le même handler :

- **`explosion`** : flash PointLight (brighness 20, range 30, 0.1s) + particles éclats (rate 500 burst, 0.2s lifetime) + particles fumée (rate 20, 2s lifetime)
- **`fire`** : ParticleEmitter flamme (Fire colors, upward speed) + ParticleEmitter fumée (grey, slow) + PointLight orange pulsé
- **`magic_aura`** : particles orbitales + PointLight coloré (customisable hue) + optionnel Beam circulaire
- **`hit_effect`** : burst de particles (rate 1000, 0.05s, radial) + flash PointLight très court
- **`smoke`** : Smoke instance native + ParticleEmitter complémentaire

```json
{
  "preset": "explosion",
  "target": "Workspace.HitPart",
  "scale": 1.0,
  "color": [255, 150, 0]
}
```

### `set_post_processing`

Crée ou met à jour les objets post-processing dans `game.Lighting` :

```json
{
  "bloom":            { "intensity": 0.5, "size": 24, "threshold": 0.95 },
  "colorCorrection":  { "saturation": 0.2, "contrast": 0.1, "tintColor": [255, 240, 220] },
  "sunRays":          { "intensity": 0.25, "spread": 1.0 },
  "depthOfField":     { "farIntensity": 0.5, "focusDistance": 50, "inFocusRadius": 10 },
  "blur":             { "size": 24 }
}
```

---

## Fichiers à modifier

| Fichier | Type de changement |
|---------|-------------------|
| `packages/core/src/tools/definitions.ts` | +21 tool definitions (batch + 20 nouveaux) |
| `packages/core/src/tools/index.ts` | +21 méthodes |
| `packages/core/src/http-server.ts` | +21 routes dans TOOL_HANDLERS |
| `studio-plugin/src/modules/Communication.ts` | +20 routes dans routeMap |
| `studio-plugin/src/modules/handlers/VFXHandlers.ts` | **Nouveau** — 6 tools VFX |
| `studio-plugin/src/modules/handlers/InstanceHandlers.ts` | +move, rename, clone, get_descendants |
| `studio-plugin/src/modules/handlers/ScriptHandlers.ts` | +get_all_scripts, find_references, execute_luau_wait |
| `studio-plugin/src/modules/handlers/MetadataHandlers.ts` | +get_camera, set_camera, get_context, get_deep_snapshot |
| `studio-plugin/src/modules/handlers/PropertyHandlers.ts` | +set_multiple_properties |
| `studio-plugin/src/modules/handlers/AudioHandlers.ts` | **Nouveau** — create_sound |

---

## Ordre d'implémentation

1. **`batch_execute`** — serveur + plugin (fondation, débloque tout le reste)
2. **Tools hiérarchie** — move, rename, clone, get_descendants, set_multiple_properties
3. **Context tools** — get_context, get_deep_snapshot
4. **VFXHandlers** — create_particle_effect, create_beam, create_trail, create_light, set_post_processing, create_vfx_preset
5. **AudioHandlers** — create_sound
6. **Scripts tools** — get_all_scripts, find_references, execute_luau_wait
7. **Camera tools** — get_camera, set_camera
8. **Build final + test** — npm run build + npm run build:plugin

---

## Critères de succès

- `batch_execute` avec 5 opérations s'exécute en < 50ms (vs 250ms+ en séquentiel)
- `create_vfx_preset("explosion", "Workspace.Part")` crée le VFX complet en 1 appel MCP
- Tous les nouveaux tools buildent sans erreur TypeScript ET roblox-ts
- Les tests existants passent toujours (`npm test`)
