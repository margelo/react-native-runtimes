#include <NativeComposeThreadedRuntimeOnLoad.hpp>
#include <ThreadedRuntimeBindingsInstaller.h>
#include <fbjni/fbjni.h>

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  return facebook::jni::initialize(vm, [] {
    margelo::nitro::threadedruntime::registerAllNatives();
    nativecompose::threadedruntime::JThreadedRuntimeBindingsInstaller::
        registerNatives();
  });
}
