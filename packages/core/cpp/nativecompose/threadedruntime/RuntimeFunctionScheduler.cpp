#include "RuntimeFunctionScheduler.h"

#include <NitroModules/Promise.hpp>
#include <NitroModules/Dispatcher.hpp>
#include <jsi/jsi.h>

#include <exception>
#include <mutex>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <utility>

namespace nativecompose::threadedruntime {
namespace {

using facebook::jsi::Function;
using facebook::jsi::Object;
using facebook::jsi::PropNameID;
using facebook::jsi::Runtime;
using facebook::jsi::String;
using facebook::jsi::Value;
using margelo::nitro::Dispatcher;
using margelo::nitro::Promise;

struct RuntimeDispatcherEntry {
  Runtime *runtime;
  std::weak_ptr<Dispatcher> dispatcher;
};

std::mutex runtimeDispatchersMutex;
std::unordered_map<std::string, RuntimeDispatcherEntry> runtimeDispatchers;

std::string valueToJson(Runtime &runtime, const Value &value)
{
  if (value.isUndefined() || value.isNull()) {
    return "null";
  }

  auto json = runtime.global().getPropertyAsObject(runtime, "JSON");
  auto stringify = json.getPropertyAsFunction(runtime, "stringify");
  auto stringified = stringify.call(runtime, value);
  if (stringified.isString()) {
    return stringified.asString(runtime).utf8(runtime);
  }

  return "null";
}

std::string errorToMessage(Runtime &runtime, const Value &value)
{
  try {
    if (value.isObject()) {
      auto object = value.asObject(runtime);
      auto message = object.getProperty(runtime, "message");
      if (message.isString()) {
        return message.asString(runtime).utf8(runtime);
      }
    }
    if (value.isString()) {
      return value.asString(runtime).utf8(runtime);
    }
    return valueToJson(runtime, value);
  } catch (...) {
    return "Runtime function rejected";
  }
}

bool isThenable(Runtime &runtime, Object &object)
{
  if (!object.hasProperty(runtime, "then")) {
    return false;
  }

  auto thenValue = object.getProperty(runtime, "then");
  return thenValue.isObject() && thenValue.asObject(runtime).isFunction(runtime);
}

void resolveFromValue(
    Runtime &runtime,
    const std::shared_ptr<Promise<std::string>> &promise,
    const Value &value)
{
  promise->resolve(valueToJson(runtime, value));
}

void rejectFromValue(
    Runtime &runtime,
    const std::shared_ptr<Promise<std::string>> &promise,
    const Value &value)
{
  promise->reject(std::make_exception_ptr(std::runtime_error(errorToMessage(runtime, value))));
}

void callInTargetRuntime(
    Runtime &runtime,
    const std::shared_ptr<Promise<std::string>> &promise,
    const std::string &functionId,
    const std::string &argsJson)
{
  auto global = runtime.global();
  auto callValue = global.getProperty(runtime, "__rnrCallRuntimeFunction");
  if (!callValue.isObject() || !callValue.asObject(runtime).isFunction(runtime)) {
    throw std::runtime_error("__rnrCallRuntimeFunction is not installed in target runtime");
  }

  auto callFunction = callValue.asObject(runtime).asFunction(runtime);
  auto result = callFunction.call(
      runtime,
      String::createFromUtf8(runtime, functionId),
      String::createFromUtf8(runtime, argsJson.empty() ? "[]" : argsJson));

  if (result.isObject()) {
    auto resultObject = result.asObject(runtime);
    if (isThenable(runtime, resultObject)) {
      auto resolve = Function::createFromHostFunction(
          runtime,
          PropNameID::forAscii(runtime, "__rnrResolveRuntimeFunction"),
          1,
          [promise](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
            if (count > 0) {
              resolveFromValue(rt, promise, args[0]);
            } else {
              auto nullValue = Value::null();
              resolveFromValue(rt, promise, nullValue);
            }
            return Value::undefined();
          });
      auto reject = Function::createFromHostFunction(
          runtime,
          PropNameID::forAscii(runtime, "__rnrRejectRuntimeFunction"),
          1,
          [promise](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
            if (count > 0) {
              rejectFromValue(rt, promise, args[0]);
            } else {
              auto undefinedValue = Value::undefined();
              rejectFromValue(rt, promise, undefinedValue);
            }
            return Value::undefined();
          });
      auto then = resultObject.getProperty(runtime, "then").asObject(runtime).asFunction(runtime);
      then.callWithThis(runtime, resultObject, resolve, reject);
      return;
    }
  }

  resolveFromValue(runtime, promise, result);
}

void scheduleInTargetRuntime(
    Runtime &runtime,
    const std::string &functionId,
    const std::string &argsJson)
{
  auto global = runtime.global();
  auto callValue = global.getProperty(runtime, "__rnrCallRuntimeFunction");
  if (!callValue.isObject() || !callValue.asObject(runtime).isFunction(runtime)) {
    throw std::runtime_error("__rnrCallRuntimeFunction is not installed in target runtime");
  }

  auto callFunction = callValue.asObject(runtime).asFunction(runtime);
  auto result = callFunction.call(
      runtime,
      String::createFromUtf8(runtime, functionId),
      String::createFromUtf8(runtime, argsJson.empty() ? "[]" : argsJson));

  if (result.isObject()) {
    auto resultObject = result.asObject(runtime);
    if (isThenable(runtime, resultObject)) {
      auto logRejection = Function::createFromHostFunction(
          runtime,
          PropNameID::forAscii(runtime, "__rnrLogScheduledRuntimeFunctionError"),
          1,
          [functionId](Runtime &rt, const Value &, const Value *args, size_t count) -> Value {
            auto message = count > 0 ? errorToMessage(rt, args[0]) : "Runtime function rejected";
            auto console = rt.global().getPropertyAsObject(rt, "console");
            auto warn = console.getPropertyAsFunction(rt, "warn");
            warn.call(
                rt,
                String::createFromUtf8(rt, "Scheduled runtime function \"" + functionId + "\" failed"),
                String::createFromUtf8(rt, message));
            return Value::undefined();
          });
      auto then = resultObject.getProperty(runtime, "then").asObject(runtime).asFunction(runtime);
      then.callWithThis(runtime, resultObject, Value::undefined(), logRejection);
    }
  }
}

} // namespace

void registerRuntimeDispatcher(
    const std::string &runtimeName,
    Runtime &runtime,
    std::weak_ptr<Dispatcher> dispatcher)
{
  std::lock_guard lock(runtimeDispatchersMutex);
  runtimeDispatchers[runtimeName] = RuntimeDispatcherEntry{&runtime, std::move(dispatcher)};
}

void unregisterRuntimeDispatcher(const std::string &runtimeName)
{
  std::lock_guard lock(runtimeDispatchersMutex);
  runtimeDispatchers.erase(runtimeName);
}

std::shared_ptr<Promise<std::string>> callOnRuntime(
    const std::string &runtimeName,
    const std::string &functionId,
    const std::string &argsJson)
{
  auto promise = Promise<std::string>::create();

  Runtime *targetRuntime = nullptr;
  std::shared_ptr<Dispatcher> targetDispatcher;
  {
    std::lock_guard lock(runtimeDispatchersMutex);
    auto iterator = runtimeDispatchers.find(runtimeName);
    if (iterator == runtimeDispatchers.end()) {
      promise->reject(std::make_exception_ptr(std::runtime_error(
          "No runtime dispatcher registered for \"" + runtimeName + "\"")));
      return promise;
    }
    targetRuntime = iterator->second.runtime;
    targetDispatcher = iterator->second.dispatcher.lock();
  }

  if (targetRuntime == nullptr || targetDispatcher == nullptr) {
    promise->reject(std::make_exception_ptr(std::runtime_error(
        "Runtime dispatcher expired for \"" + runtimeName + "\"")));
    return promise;
  }

  try {
    targetDispatcher->runAsync([promise, targetRuntime, functionId, argsJson]() {
      try {
        callInTargetRuntime(*targetRuntime, promise, functionId, argsJson);
      } catch (...) {
        promise->reject(std::current_exception());
      }
    });
  } catch (...) {
    promise->reject(std::current_exception());
  }

  return promise;
}

std::shared_ptr<Promise<void>> scheduleRuntimeFunctionOnRuntime(
    const std::string &runtimeName,
    const std::string &functionId,
    const std::string &argsJson)
{
  auto promise = Promise<void>::create();

  Runtime *targetRuntime = nullptr;
  std::shared_ptr<Dispatcher> targetDispatcher;
  {
    std::lock_guard lock(runtimeDispatchersMutex);
    auto iterator = runtimeDispatchers.find(runtimeName);
    if (iterator == runtimeDispatchers.end()) {
      promise->reject(std::make_exception_ptr(std::runtime_error(
          "No runtime dispatcher registered for \"" + runtimeName + "\"")));
      return promise;
    }
    targetRuntime = iterator->second.runtime;
    targetDispatcher = iterator->second.dispatcher.lock();
  }

  if (targetRuntime == nullptr || targetDispatcher == nullptr) {
    promise->reject(std::make_exception_ptr(std::runtime_error(
        "Runtime dispatcher expired for \"" + runtimeName + "\"")));
    return promise;
  }

  try {
    targetDispatcher->runAsync([targetRuntime, functionId, argsJson]() {
      try {
        scheduleInTargetRuntime(*targetRuntime, functionId, argsJson);
      } catch (const std::exception &error) {
        // Keep scheduled calls fire-and-forget: failures are reported on the
        // target runtime, not to the scheduling caller.
        try {
          auto &runtime = *targetRuntime;
          auto console = runtime.global().getPropertyAsObject(runtime, "console");
          auto warn = console.getPropertyAsFunction(runtime, "warn");
          warn.call(
              runtime,
              String::createFromUtf8(runtime, "Scheduled runtime function \"" + functionId + "\" failed"),
              String::createFromUtf8(runtime, error.what()));
        } catch (...) {
        }
      }
    });
    promise->resolve();
  } catch (...) {
    promise->reject(std::current_exception());
  }

  return promise;
}

} // namespace nativecompose::threadedruntime
