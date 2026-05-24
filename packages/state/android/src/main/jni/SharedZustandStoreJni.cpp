#include "SharedZustandStoreJni.h"

#include "SharedZustandStore.hpp"

#include <optional>

using ::margelo::nitro::threadedzustand::SharedZustandStore;

namespace facebook::react {

void SharedZustandStoreJni::registerNatives() {
  javaClassLocal()->registerNatives({
      makeNativeMethod("nativeGetState", SharedZustandStoreJni::nativeGetState),
      makeNativeMethod(
          "nativeGetOrInitState",
          SharedZustandStoreJni::nativeGetOrInitState),
      makeNativeMethod("nativeSetState", SharedZustandStoreJni::nativeSetState),
      makeNativeMethod(
          "nativeGetRevision", SharedZustandStoreJni::nativeGetRevision),
      makeNativeMethod("nativeClear", SharedZustandStoreJni::nativeClear),
      makeNativeMethod(
          "nativeSetPersistenceDirectory",
          SharedZustandStoreJni::nativeSetPersistenceDirectory),
      makeNativeMethod(
          "nativeSetPersistedState",
          SharedZustandStoreJni::nativeSetPersistedState),
      makeNativeMethod(
          "nativeClearPersistedState",
          SharedZustandStoreJni::nativeClearPersistedState),
  });
}

jni::local_ref<jstring> SharedZustandStoreJni::nativeGetState(
    jni::alias_ref<SharedZustandStoreJni> /*jobj*/,
    jni::alias_ref<jstring> storeName,
    jni::alias_ref<jstring> subtreeKey) {
  const auto entry = SharedZustandStore::instance().getState(
      storeName->toStdString(), subtreeKey->toStdString());
  if (!entry.has_value()) {
    return nullptr;
  }
  return jni::make_jstring(entry->stateJson);
}

jni::local_ref<jstring> SharedZustandStoreJni::nativeGetOrInitState(
    jni::alias_ref<SharedZustandStoreJni> /*jobj*/,
    jni::alias_ref<jstring> storeName,
    jni::alias_ref<jstring> subtreeKey,
    jni::alias_ref<jstring> initialJson,
    jni::alias_ref<jstring> persistKey) {
  std::optional<std::string> nativePersistKey;
  if (persistKey != nullptr) {
    nativePersistKey = persistKey->toStdString();
  }
  const auto entry = SharedZustandStore::instance().getOrInitState(
      storeName->toStdString(),
      subtreeKey->toStdString(),
      initialJson->toStdString(),
      nativePersistKey);
  return jni::make_jstring(entry.stateJson);
}

jint SharedZustandStoreJni::nativeSetState(
    jni::alias_ref<SharedZustandStoreJni> /*jobj*/,
    jni::alias_ref<jstring> storeName,
    jni::alias_ref<jstring> subtreeKey,
    jni::alias_ref<jstring> stateJson) {
  const auto entry = SharedZustandStore::instance().setState(
      storeName->toStdString(),
      subtreeKey->toStdString(),
      stateJson->toStdString());
  return entry.revision;
}

jint SharedZustandStoreJni::nativeGetRevision(
    jni::alias_ref<SharedZustandStoreJni> /*jobj*/,
    jni::alias_ref<jstring> storeName,
    jni::alias_ref<jstring> subtreeKey) {
  return SharedZustandStore::instance().getRevision(
      storeName->toStdString(), subtreeKey->toStdString());
}

jint SharedZustandStoreJni::nativeClear(
    jni::alias_ref<SharedZustandStoreJni> /*jobj*/,
    jni::alias_ref<jstring> storeName,
    jni::alias_ref<jstring> subtreeKey) {
  return SharedZustandStore::instance().clear(
      storeName->toStdString(), subtreeKey->toStdString());
}

void SharedZustandStoreJni::nativeSetPersistenceDirectory(
    jni::alias_ref<SharedZustandStoreJni> /*jobj*/,
    jni::alias_ref<jstring> directory) {
  SharedZustandStore::instance().setPersistenceDirectory(
      directory->toStdString());
}

void SharedZustandStoreJni::nativeSetPersistedState(
    jni::alias_ref<SharedZustandStoreJni> /*jobj*/,
    jni::alias_ref<jstring> persistKey,
    jni::alias_ref<jstring> stateJson) {
  SharedZustandStore::instance().setPersistedState(
      persistKey->toStdString(), stateJson->toStdString());
}

void SharedZustandStoreJni::nativeClearPersistedState(
    jni::alias_ref<SharedZustandStoreJni> /*jobj*/,
    jni::alias_ref<jstring> persistKey) {
  SharedZustandStore::instance().clearPersistedState(persistKey->toStdString());
}

} // namespace facebook::react
