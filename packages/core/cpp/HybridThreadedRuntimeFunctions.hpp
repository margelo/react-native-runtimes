//
//  HybridThreadedRuntimeFunctions.hpp
//  Pods
//
//  Created by Ritesh Shukla on 24/05/26.
//


#pragma once

#include "HybridThreadedRuntimeFunctionsSpec.hpp"

#include <jsi/jsi.h>

#include <memory>
#include <string>

namespace margelo::nitro::threadedruntime {

class HybridThreadedRuntimeFunctions final
    : public HybridThreadedRuntimeFunctionsSpec {
 public:
  HybridThreadedRuntimeFunctions() : HybridObject(TAG) {}

  std::shared_ptr<Promise<std::string>> run(
      const std::string& runtimeName,
      const std::string& functionId,
      const std::string& argsJson) override;

  // Raw JSI escape hatch — install requires `jsi::Runtime&` because it injects
  // host functions into the runtime's global and registers a Nitro Dispatcher
  // for cross-runtime scheduling. See
  // https://nitro.margelo.com/docs/types/raw-jsi-value
  facebook::jsi::Value install(
      facebook::jsi::Runtime& runtime,
      const facebook::jsi::Value& thisValue,
      const facebook::jsi::Value* args,
      size_t count);

 protected:
  void loadHybridMethods() override;
};

} // namespace margelo::nitro::threadedruntime
