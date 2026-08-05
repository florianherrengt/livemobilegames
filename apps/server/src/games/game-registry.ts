import { type GameManifest, gameManifestSchema } from "@phone-party/protocol";

import type { GameDefinition } from "./game-definition.js";

export class GameRegistry {
  // The registry is immutable after construction. Frozen manifests/definitions
  // and copied return values prevent callers from mutating trusted game data.
  readonly #definitions: readonly GameDefinition[];
  readonly #byId: ReadonlyMap<string, GameDefinition>;

  constructor(definitions: readonly GameDefinition[]) {
    const byId = new Map<string, GameDefinition>();
    const validated: GameDefinition[] = [];

    for (const definition of definitions) {
      const manifest = gameManifestSchema.parse(definition.manifest);
      const frozenManifest = Object.freeze(manifest);
      if (byId.has(manifest.id)) {
        throw new Error(`Duplicate game id: ${manifest.id}`);
      }
      if (validated.some((existing) => existing.roomType === definition.roomType)) {
        throw new Error(`Duplicate room type: ${definition.roomType}`);
      }

      const validatedDefinition: GameDefinition = Object.freeze({
        manifest: frozenManifest,
        roomType: definition.roomType,
        roomClass: definition.roomClass,
      });
      byId.set(manifest.id, validatedDefinition);
      validated.push(validatedDefinition);
    }

    this.#definitions = Object.freeze(validated);
    this.#byId = byId;
  }

  listManifests(): readonly GameManifest[] {
    return this.#definitions.map((definition) => ({ ...definition.manifest }));
  }

  listDefinitions(): readonly GameDefinition[] {
    return this.#definitions;
  }

  findById(gameId: string): GameDefinition | undefined {
    return this.#byId.get(gameId);
  }
}

export function createGameRegistry(definitions: readonly GameDefinition[]): GameRegistry {
  return new GameRegistry(definitions);
}
