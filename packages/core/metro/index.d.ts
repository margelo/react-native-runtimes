type ThreadedRuntimeMetroOptions = {
  generatedDir?: string;
  generatedEntry?: string;
  platformExtensions?: string[];
  projectRoot?: string;
  roots?: string[];
  sourceExtensions?: string[];
};

type ThreadedRuntimeComponentRegistration = {
  exportName: string;
  file: string;
  name: string;
};

type ThreadedRuntimeEntryRegistration = {
  file: string;
  runtimeName: string;
};

type RuntimeFunctionRegistration = {
  exportName: string;
  file: string;
  id: string;
};

export function generateThreadedRuntimeEntry(options: {
  generatedEntry: string;
  platformExtensions?: string[];
  projectRoot?: string;
  roots?: string[];
  sourceExtensions?: string[];
}): {
  components: ThreadedRuntimeComponentRegistration[];
  generatedEntry: string;
  runtimeFunctions: RuntimeFunctionRegistration[];
  runtimeEntries: ThreadedRuntimeEntryRegistration[];
};

export function withThreadedRuntime<TConfig extends object>(
  config: TConfig,
  options?: ThreadedRuntimeMetroOptions,
): TConfig & {
  watchFolders?: string[];
};
