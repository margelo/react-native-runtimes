#pragma once

#include <string>

#if defined(__ANDROID__)
#include <jni.h>
#endif

namespace nativecompose::threadedruntime {

#if defined(__ANDROID__)
inline void schedule(
    JNIEnv *env,
    jobject context,
    const std::string &runtimeName,
    const std::string &functionId,
    const std::string &argsJson)
{
  jclass runtimeClass =
      env->FindClass("com/nativecompose/threadedruntime/ThreadedRuntime");
  if (runtimeClass == nullptr) {
    return;
  }

  jmethodID scheduleMethod = env->GetStaticMethodID(
      runtimeClass,
      "schedule",
      "(Landroid/content/Context;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)V");
  if (scheduleMethod == nullptr) {
    env->DeleteLocalRef(runtimeClass);
    return;
  }

  jstring runtimeNameValue = env->NewStringUTF(runtimeName.c_str());
  jstring functionIdValue = env->NewStringUTF(functionId.c_str());
  jstring argsJsonValue = env->NewStringUTF(argsJson.c_str());
  env->CallStaticVoidMethod(
      runtimeClass,
      scheduleMethod,
      context,
      runtimeNameValue,
      functionIdValue,
      argsJsonValue);

  env->DeleteLocalRef(argsJsonValue);
  env->DeleteLocalRef(functionIdValue);
  env->DeleteLocalRef(runtimeNameValue);
  env->DeleteLocalRef(runtimeClass);
}

inline void prewarmRuntime(
    JNIEnv *env,
    jobject context,
    const std::string &runtimeName,
    const std::string &kind,
    bool useMainNativeModules)
{
  jclass runtimeClass =
      env->FindClass("com/nativecompose/threadedruntime/ThreadedRuntime");
  if (runtimeClass == nullptr) {
    return;
  }

  jmethodID prewarmMethod = env->GetStaticMethodID(
      runtimeClass,
      "prewarmRuntimeWithOptions",
      "(Landroid/content/Context;Ljava/lang/String;Ljava/lang/String;Z)V");
  if (prewarmMethod == nullptr) {
    env->DeleteLocalRef(runtimeClass);
    return;
  }

  jstring runtimeNameValue = env->NewStringUTF(runtimeName.c_str());
  jstring kindValue = env->NewStringUTF(kind.c_str());
  env->CallStaticVoidMethod(
      runtimeClass,
      prewarmMethod,
      context,
      runtimeNameValue,
      kindValue,
      static_cast<jboolean>(useMainNativeModules));

  env->DeleteLocalRef(kindValue);
  env->DeleteLocalRef(runtimeNameValue);
  env->DeleteLocalRef(runtimeClass);
}

inline void prewarmBusinessRuntime(
    JNIEnv *env,
    jobject context,
    const std::string &runtimeName)
{
  prewarmRuntime(env, context, runtimeName, "business-runtime", true);
}
#elif defined(__APPLE__)
void schedule(
    const std::string &runtimeName,
    const std::string &functionId,
    const std::string &argsJson);

void prewarmRuntime(const std::string &runtimeName);
void prewarmRuntime(
    const std::string &runtimeName,
    const std::string &kind,
    bool useMainNativeModules);
void prewarmBusinessRuntime(const std::string &runtimeName);
#endif

} // namespace nativecompose::threadedruntime
