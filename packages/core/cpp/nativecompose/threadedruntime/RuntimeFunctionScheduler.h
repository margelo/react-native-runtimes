#pragma once

#include <memory>
#include <string>

namespace facebook::jsi {
class Runtime;
} // namespace facebook::jsi

namespace margelo::nitro {
class Dispatcher;
} // namespace margelo::nitro

namespace margelo::nitro {
template <typename T>
class Promise;
} // namespace margelo::nitro

namespace nativecompose::threadedruntime {

void registerRuntimeDispatcher(
    const std::string &runtimeName,
    facebook::jsi::Runtime &runtime,
    std::weak_ptr<margelo::nitro::Dispatcher> dispatcher);

void unregisterRuntimeDispatcher(const std::string &runtimeName);

std::shared_ptr<margelo::nitro::Promise<std::string>> callOnRuntime(
    const std::string &runtimeName,
    const std::string &functionId,
    const std::string &argsJson);

std::shared_ptr<margelo::nitro::Promise<void>> scheduleRuntimeFunctionOnRuntime(
    const std::string &runtimeName,
    const std::string &functionId,
    const std::string &argsJson);

} // namespace nativecompose::threadedruntime
