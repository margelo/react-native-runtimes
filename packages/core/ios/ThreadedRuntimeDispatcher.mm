#import "ThreadedRuntime.h"

#include "../cpp/nativecompose/threadedruntime/ThreadedRuntimeDispatcher.h"

namespace nativecompose::threadedruntime {

static NSString *NSStringFromStdString(const std::string &value)
{
  return [NSString stringWithUTF8String:value.c_str()];
}

void schedule(
    const std::string &runtimeName,
    const std::string &functionId,
    const std::string &argsJson)
{
  [ThreadedRuntime scheduleWithRuntimeName:NSStringFromStdString(runtimeName)
                                functionId:NSStringFromStdString(functionId)
                                  argsJson:NSStringFromStdString(argsJson)];
}

void prewarmRuntime(const std::string &runtimeName)
{
  [ThreadedRuntime prewarmRuntime:NSStringFromStdString(runtimeName)];
}

void prewarmRuntime(
    const std::string &runtimeName,
    const std::string &kind,
    bool useMainNativeModules)
{
  [ThreadedRuntime prewarmRuntime:NSStringFromStdString(runtimeName)
                             kind:NSStringFromStdString(kind)
             useMainNativeModules:useMainNativeModules];
}

void prewarmBusinessRuntime(const std::string &runtimeName)
{
  [ThreadedRuntime prewarmBusinessRuntime:NSStringFromStdString(runtimeName)];
}

} // namespace nativecompose::threadedruntime
