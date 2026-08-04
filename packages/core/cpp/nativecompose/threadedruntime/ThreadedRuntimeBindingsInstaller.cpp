#include "ThreadedRuntimeBindingsInstaller.h"

#ifdef __ANDROID__

namespace nativecompose::threadedruntime {

namespace jsi = facebook::jsi;

facebook::jni::local_ref<JThreadedRuntimeBindingsInstaller::jhybriddata>
JThreadedRuntimeBindingsInstaller::initHybrid(
    facebook::jni::alias_ref<jclass>,
    std::string runtimeName,
    std::string kind) {
  return makeCxxInstance(std::move(runtimeName), std::move(kind));
}

void JThreadedRuntimeBindingsInstaller::registerNatives() {
  registerHybrid({
      makeNativeMethod(
          "initHybrid", JThreadedRuntimeBindingsInstaller::initHybrid),
  });
}

facebook::react::BindingsInstaller::BindingsInstallFunc
JThreadedRuntimeBindingsInstaller::getBindingsInstallFunc() {
  return [runtimeName = runtimeName_, kind = kind_](jsi::Runtime& runtime) {
    auto env = jsi::Object(runtime);
    env.setProperty(
        runtime, "kind", jsi::String::createFromUtf8(runtime, kind));
    env.setProperty(
        runtime,
        "runtimeName",
        jsi::String::createFromUtf8(runtime, runtimeName));
    runtime.global().setProperty(runtime, "__THREADED_RUNTIME_ENV__", env);
  };
}

} // namespace nativecompose::threadedruntime

#endif // __ANDROID__
