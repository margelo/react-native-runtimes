import type { HybridObject } from 'react-native-nitro-modules';

export interface ThreadedRuntimeFunctions
  extends HybridObject<{ ios: 'c++'; android: 'c++' }> {
  run(
    runtimeName: string,
    functionId: string,
    argsJson: string,
  ): Promise<string>;
}
