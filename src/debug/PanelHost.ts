import type { RuleId } from '../contracts/catalog';
import type { RuleCategory } from '../contracts/rules';
import type { SectionMode } from '../game/Game';
import type { NetInfo } from '../net/NetPlayers';
import type { SaveMeta } from '../saves/SaveStore';

export type SeedModeId = 'timer' | 'position' | 'both' | 'constant' | 'timerpos' | 'field';
export type NetMode = 'offline' | 'hosting' | 'joining' | 'client';

/**
 * Everything the panel can ask the app to do. main.ts implements it with the
 * concrete systems, so the panel never imports them. Shared-state changes go
 * through the session (and so stay in sync online).
 */
export interface PanelHost {
  game: {
    isPaused(): boolean;
    setPaused(p: boolean): void;
    restart(): void;
    newGame(): void;
  };
  rules: {
    setOverride(id: RuleId, v: number | null): void;
    setSection(cat: RuleCategory, mode: SectionMode | null): void;
    clearForced(): void;
  };
  seed: {
    getBase(): number;
    setBase(input: string): void;
    randomize(): void;
    rerollNow(): void;
    getMode(): SeedModeId;
    setMode(m: SeedModeId): void;
    getPeriodSec(): number;
    setPeriodSec(s: number): void;
    getZoneSize(): number;
    setZoneSize(px: number): void;
    getPrecision(): number;
    setPrecision(px: number): void;
    isTimerPaused(): boolean;
    setTimerPaused(p: boolean): void;
    shareLink(): string;
  };
  field: {
    getSource(): 'random' | 'image' | 'axes';
    setSource(s: 'random' | 'image' | 'axes'): void;
    hasImage(): boolean;
    loadImage(file: File): Promise<string | null>; // error message or null
    clearImage(): void;
    getActivity(): number;
    setActivity(v: number): void;
    getWalk(): number;
    setWalk(v: number): void;
    dims(): number;
    /** Turn your map's → axis toward the way this rule gets stronger. */
    steer(id: string): void;
    straighten(): void;
  };
  saves: {
    list(): SaveMeta[];
    save(): string | null; // error message, or null on success
    load(id: string): void;
    remove(id: string): void;
  };
  net: {
    mode(): NetMode;
    room(): string | null;
    error(): string | null;
    info(): NetInfo | null;
    inviteLink(): string | null;
    host(): void;
    join(room: string): void;
    leave(): void;
  };
}
