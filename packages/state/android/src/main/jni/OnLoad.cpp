#include "SharedZustandStoreJni.h"

#include <NativeComposeThreadedZustandOnLoad.hpp>
#include <fbjni/fbjni.h>

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  return facebook::jni::initialize(vm, [] {
    facebook::react::SharedZustandStoreJni::registerNatives();
    margelo::nitro::threadedzustand::registerAllNatives();
  });
}
