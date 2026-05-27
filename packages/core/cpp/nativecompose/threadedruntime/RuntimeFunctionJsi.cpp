#include "RuntimeFunctionJsi.h"

#include <memory>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <vector>

namespace nativecompose::threadedruntime {
namespace {

using facebook::jsi::Function;
using facebook::jsi::Object;
using facebook::jsi::PropNameID;
using facebook::jsi::Runtime;
using facebook::jsi::String;
using facebook::jsi::Value;

struct RuntimeFunctionEntry {
  std::shared_ptr<Function> loader;
  std::shared_ptr<Function> cachedFunction;
};

class RuntimeFunctionRegistry
    : public std::enable_shared_from_this<RuntimeFunctionRegistry> {
 public:
  void registerLoader(Runtime &runtime, const std::string &id, const Value &loader)
  {
    if (!loader.isObject() || !loader.asObject(runtime).isFunction(runtime)) {
      throw std::runtime_error(
          "runtime function registration requires a function loader");
    }

    entries_[id] = RuntimeFunctionEntry{
        std::make_shared<Function>(loader.asObject(runtime).asFunction(runtime)),
        nullptr};
  }

  Value call(Runtime &runtime, const std::string &id, const std::string &argsJson)
  {
    auto entryIterator = entries_.find(id);
    if (entryIterator == entries_.end()) {
      throw std::runtime_error("No runtime function registered for \"" + id + "\"");
    }

    auto &entry = entryIterator->second;
    if (!entry.cachedFunction) {
      auto loaded = entry.loader->call(runtime);
      if (!loaded.isObject() || !loaded.asObject(runtime).isFunction(runtime)) {
        throw std::runtime_error(
            "Runtime function loader did not return a function for \"" + id + "\"");
      }
      entry.cachedFunction = std::make_shared<Function>(
          loaded.asObject(runtime).asFunction(runtime));
    }

    auto argsValue = parseArgs(runtime, argsJson);
    auto argsArray = argsValue.asObject(runtime).asArray(runtime);
    const auto size = argsArray.size(runtime);
    std::vector<Value> args;
    args.reserve(size);
    for (size_t index = 0; index < size; index += 1) {
      args.push_back(argsArray.getValueAtIndex(runtime, index));
    }

    const Value *callArgs = args.empty() ? nullptr : args.data();
    const size_t callArgCount = args.size();
    return entry.cachedFunction->call(runtime, callArgs, callArgCount);
  }

 private:
  Value parseArgs(Runtime &runtime, const std::string &argsJson)
  {
    auto json = runtime.global().getPropertyAsObject(runtime, "JSON");
    auto parse = json.getPropertyAsFunction(runtime, "parse");
    auto parsed = parse.call(
        runtime,
        String::createFromUtf8(runtime, argsJson.empty() ? "[]" : argsJson));
    if (parsed.isObject() && parsed.asObject(runtime).isArray(runtime)) {
      return parsed;
    }

    auto wrapped = facebook::jsi::Array(runtime, 1);
    wrapped.setValueAtIndex(runtime, 0, std::move(parsed));
    return wrapped;
  }

  std::unordered_map<std::string, RuntimeFunctionEntry> entries_;
};

} // namespace

void installRuntimeFunctionJsi(Runtime &runtime, const std::string &runtimeName)
{
  auto registry = std::make_shared<RuntimeFunctionRegistry>();

  auto registerFunction = Function::createFromHostFunction(
      runtime,
      PropNameID::forAscii(runtime, "__rnrRegisterRuntimeFunction"),
      2,
      [registry](
          Runtime &rt,
          const Value & /*thisValue*/,
          const Value *args,
          size_t count) -> Value {
        if (count < 2 || !args[0].isString()) {
          throw std::runtime_error(
              "__rnrRegisterRuntimeFunction expects (id, loader)");
        }

        registry->registerLoader(rt, args[0].asString(rt).utf8(rt), args[1]);
        return Value::undefined();
      });

  auto callFunction = Function::createFromHostFunction(
      runtime,
      PropNameID::forAscii(runtime, "__rnrCallRuntimeFunction"),
      2,
      [registry](
          Runtime &rt,
          const Value & /*thisValue*/,
          const Value *args,
          size_t count) -> Value {
        if (count < 2 || !args[0].isString() || !args[1].isString()) {
          throw std::runtime_error(
              "__rnrCallRuntimeFunction expects (functionId, argsJson)");
        }

        return registry->call(
            rt,
            args[0].asString(rt).utf8(rt),
            args[1].asString(rt).utf8(rt));
      });

  runtime.global().setProperty(
      runtime,
      "__rnrRegisterRuntimeFunction",
      std::move(registerFunction));
  runtime.global().setProperty(
      runtime,
      "__rnrCallRuntimeFunction",
      std::move(callFunction));
}

} // namespace nativecompose::threadedruntime
