//
//  HybridThreadedRuntimeFunctions.cpp
//  Pods
//
//  Created by Ritesh Shukla on 24/05/26.
//




#include "HybridThreadedRuntimeFunctions.hpp"

#include "nativecompose/threadedruntime/RuntimeFunctionJsi.h"
#include "nativecompose/threadedruntime/RuntimeFunctionScheduler.h"

#include <NitroModules/Dispatcher.hpp>

namespace margelo::nitro::threadedruntime {

std::shared_ptr<Promise<std::string>> HybridThreadedRuntimeFunctions::run(
    const std::string& runtimeName,
    const std::string& functionId,
    const std::string& argsJson) {
  return ::nativecompose::threadedruntime::callRuntimeFunctionOnRuntime(
      runtimeName, functionId, argsJson);
}

facebook::jsi::Value HybridThreadedRuntimeFunctions::install(
    facebook::jsi::Runtime& runtime,
    const facebook::jsi::Value& /*thisValue*/,
    const facebook::jsi::Value* args,
    size_t count) {
  std::string runtimeName;
  if (count > 0 && args[0].isString()) {
    runtimeName = args[0].asString(runtime).utf8(runtime);
  }

  ::nativecompose::threadedruntime::installRuntimeFunctionJsi(
      runtime, runtimeName);
  try {
    ::nativecompose::threadedruntime::registerRuntimeDispatcher(
        runtimeName,
        runtime,
        Dispatcher::getRuntimeGlobalDispatcher(runtime));
  } catch (...) {
    // The runtime can still use the local JSI cache even if Nitro has not
    // installed a dispatcher for cross-runtime scheduling yet.
  }
  return facebook::jsi::Value::undefined();
}

void HybridThreadedRuntimeFunctions::loadHybridMethods() {
  HybridThreadedRuntimeFunctionsSpec::loadHybridMethods();
  registerHybrids(this, [](Prototype& prototype) {
    prototype.registerRawHybridMethod(
        "install", 1, &HybridThreadedRuntimeFunctions::install);
  });
}

} // namespace margelo::nitro::threadedruntime
