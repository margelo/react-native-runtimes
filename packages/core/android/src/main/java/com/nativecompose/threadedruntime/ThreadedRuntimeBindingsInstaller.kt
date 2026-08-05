package com.nativecompose.threadedruntime

import com.facebook.jni.HybridData
import com.facebook.react.runtime.BindingsInstaller

/**
 * Installs `__THREADED_RUNTIME_ENV__` into a secondary runtime's jsi::Runtime
 * during ReactInstance initialization — before any script (including Metro
 * polyfills) evaluates, and regardless of whether the bundle comes from the
 * delegate loader (release) or dev support (debug + Metro). Android
 * counterpart of the JSI injection iOS does in `host:didInitializeRuntime:`.
 */
internal class ThreadedRuntimeBindingsInstaller(runtimeName: String, kind: String) :
    BindingsInstaller(initHybrid(runtimeName, kind)) {
  private companion object {
    init {
      com.margelo.nitro.threadedruntime.NativeComposeThreadedRuntimeOnLoad.initializeNative()
    }

    @JvmStatic private external fun initHybrid(runtimeName: String, kind: String): HybridData
  }
}
