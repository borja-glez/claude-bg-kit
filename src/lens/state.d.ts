import type { PanelModel } from './model';
export type LensPanel = PanelModel;
declare module 'claude-code' {
  interface PluginState {
    lens: { panel: LensPanel | null; hidden: boolean };
  }
}
