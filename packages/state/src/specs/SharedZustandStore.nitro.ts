import type { HybridObject } from 'react-native-nitro-modules';

export interface SharedZustandStore
  extends HybridObject<{ ios: 'c++'; android: 'c++' }> {
  getState(storeName: string, subtreeKey: string): string | undefined;
  getOrInitState(
    storeName: string,
    subtreeKey: string,
    initialJson: string,
    persistKey: string,
  ): string;
  setState(
    storeName: string,
    subtreeKey: string,
    stateJson: string,
  ): number;
  getRevision(storeName: string, subtreeKey: string): number;
  clear(storeName: string, subtreeKey: string): number;
  setPersistedState(persistKey: string, stateJson: string): void;
  clearPersistedState(persistKey: string): void;
}
