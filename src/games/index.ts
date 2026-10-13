import { DEFAULT_GAME, type GameId } from './types';
import type { GameModule } from './module';
import { CHAIN_MODULE } from './chain';
import { BIOBUZZ_MODULE } from './biobuzz';

export type { GameId, StaticSpec, FieldBounds, FieldColliders, GameUiSpec, GameSimModule } from './types';
export type { GameModule } from './module';

/**
 * The FULL (client) game registry: one `GameModule` (sim + renderers + builder
 * metadata) per playable game. The browser resolves the active module from a
 * world's/settings' `GameId`. The server uses the DOM-free `./sim.ts` registry.
 *
 * Typed PARTIAL on purpose: a game that hasn't been built yet is simply absent,
 * and BOTH resolvers fall back to `DEFAULT_GAME` (BIOBUZZ). `DEFAULT_GAME` must
 * always be present.
 */
export const GAMES: Partial<Record<GameId, GameModule>> = {
  chain: CHAIN_MODULE,
  biobuzz: BIOBUZZ_MODULE,
};

/** the module for a game id, defaulting to `DEFAULT_GAME` (undefined / unknown). */
export function moduleFor(id: GameId | undefined | null): GameModule {
  return (id && GAMES[id]) || GAMES[DEFAULT_GAME] || BIOBUZZ_MODULE;
}

/** the module a world belongs to (its `game`, defaulting to `DEFAULT_GAME`). */
export function gameOf(world: { game?: GameId } | null | undefined): GameModule {
  return moduleFor(world?.game);
}

/** the games actually registered (for pickers / iteration). */
export function registeredGames(): GameModule[] {
  return Object.values(GAMES).filter((m): m is GameModule => !!m);
}
