#pragma once

// Android-only: fbjni hybrid backing the Kotlin ThreadedRuntimeBindingsInstaller.
// iOS injects the env global in host:didInitializeRuntime: (ThreadedRuntime.mm).
#ifdef __ANDROID__

#include <fbjni/fbjni.h>
#include <jsi/jsi.h>

#include <functional>
#include <string>

namespace facebook::react {

// Layout replicas of two React Native headers that are not exported through
// the ReactAndroid prefab (react/runtime/BindingsInstaller.h and
// react/runtime/jni/JBindingsInstaller.h). ReactHostImpl invokes
// getBindingsInstallFunc() through this exact class shape, so the replicas
// must stay byte-identical to the RN version in use (0.86). Revisit on RN
// upgrades.
class BindingsInstaller {
 public:
  using BindingsInstallFunc = std::function<void(jsi::Runtime& runtime)>;

  virtual BindingsInstallFunc getBindingsInstallFunc() {
    return nullptr;
  }
};

class JBindingsInstaller : public jni::HybridClass<JBindingsInstaller>,
                           public BindingsInstaller {
 public:
  static constexpr auto kJavaDescriptor =
      "Lcom/facebook/react/runtime/BindingsInstaller;";

  ~JBindingsInstaller() {}

 private:
  friend HybridBase;
};

} // namespace facebook::react

namespace nativecompose::threadedruntime {

// Injects the __THREADED_RUNTIME_ENV__ global into a secondary runtime's
// jsi::Runtime during ReactInstance::initializeRuntime — on the JS thread,
// before any script (including Metro polyfills) evaluates, and independent of
// whether the bundle comes from the delegate loader (release) or dev support
// (debug + Metro). This is the Android counterpart of the JSI injection iOS
// does in host:didInitializeRuntime:.
class JThreadedRuntimeBindingsInstaller
    : public facebook::jni::HybridClass<
          JThreadedRuntimeBindingsInstaller,
          facebook::react::JBindingsInstaller> {
 public:
  static constexpr auto kJavaDescriptor =
      "Lcom/nativecompose/threadedruntime/ThreadedRuntimeBindingsInstaller;";

  static facebook::jni::local_ref<jhybriddata> initHybrid(
      facebook::jni::alias_ref<jclass>,
      std::string runtimeName,
      std::string kind);

  static void registerNatives();

  facebook::react::BindingsInstaller::BindingsInstallFunc
  getBindingsInstallFunc() override;

 private:
  friend HybridBase;

  JThreadedRuntimeBindingsInstaller(std::string runtimeName, std::string kind)
      : runtimeName_(std::move(runtimeName)), kind_(std::move(kind)) {}

  std::string runtimeName_;
  std::string kind_;
};

} // namespace nativecompose::threadedruntime

#endif // __ANDROID__
