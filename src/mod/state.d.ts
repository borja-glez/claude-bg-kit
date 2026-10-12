import type { BandModel } from './model';
export type WaypointBand = BandModel;
declare module 'claude-code' {
  interface PluginState {
    waypoint: { band: WaypointBand; hidden: boolean };
  }
}
