package com.nativecompose.threadedruntime

import android.app.Activity
import android.content.Context
import android.util.Log
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.JSBundleLoader
import com.facebook.react.bridge.JSBundleLoaderDelegate
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.NativeArray
import com.facebook.react.bridge.Promise
import com.facebook.react.common.LifecycleState
import com.facebook.react.common.annotations.FrameworkAPI
import com.facebook.react.common.annotations.UnstableReactNativeAPI
import com.facebook.react.defaults.DefaultComponentsRegistry
import com.facebook.react.defaults.DefaultReactHostDelegate
import com.facebook.react.defaults.DefaultTurboModuleManagerDelegate
import com.facebook.react.fabric.ComponentFactory
import com.facebook.react.interfaces.fabric.ReactSurface
import com.facebook.react.modules.core.DefaultHardwareBackBtnHandler
import com.facebook.react.runtime.ReactHostImpl
import com.facebook.react.runtime.hermes.HermesInstance
import com.facebook.react.shell.MainReactPackage
import com.facebook.react.uimanager.ThemedReactContext
import java.lang.reflect.Method
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.UUID

object ThreadedRuntime {
  const val DEFAULT_RUNTIME_NAME = "background-list"
  const val MAIN_RUNTIME_NAME = "main"
  const val DEFAULT_BUSINESS_RUNTIME_NAME = "business-runtime"
  const val DEFAULT_HOST_APP_NAME = "ThreadedRuntimeHost"
  const val DEFAULT_RUNTIME_KIND = "threaded-runtime"
  const val BUSINESS_RUNTIME_KIND = "business-runtime"
  private const val HEADLESS_TASK_RUNNER_MODULE = "ThreadedRuntimeHeadlessTaskRunner"
  private const val RUNTIME_FUNCTION_RUNNER_MODULE = "ThreadedRuntimeFunctionRunner"
  private const val LOG_TAG = "ThreadedRuntime"
  // Generous because in dev the first worker bundle request can trigger a full
  // Metro graph build.
  private const val RUNTIME_READY_TIMEOUT_MS = 120_000L
  // Metro path of the worker entry (relative to the project root), generated
  // by @react-native-runtimes/core/metro. Only used in dev; release loads the
  // embedded app bundle. Override via setWorkerJsMainModulePath when the metro
  // plugin is configured with a custom generatedDir/generatedEntry.
  private const val DEFAULT_WORKER_JS_MAIN_MODULE_PATH = ".threaded-runtime/entry"

  private data class HeadlessTaskRequest(
      val taskName: String,
      val payloadJson: String,
  )

  private data class RuntimeFunctionCallRequest(
      val functionId: String,
      val argsJson: String,
      val callId: String,
  )

  internal data class RuntimeOptions(
      val kind: String = DEFAULT_RUNTIME_KIND,
      val useMainNativeModules: Boolean = false,
  )

  private val lock = Any()
  private val hosts = mutableMapOf<String, ReactHost>()
  private val runtimeOptions = mutableMapOf<String, RuntimeOptions>()
  private val pendingHeadlessTasks = mutableMapOf<String, MutableList<HeadlessTaskRequest>>()
  private val pendingRuntimeFunctionCalls =
      mutableMapOf<String, MutableList<RuntimeFunctionCallRequest>>()
  private val pendingRuntimeFunctionPromises = mutableMapOf<String, Promise>()
  private val startingRuntimes = mutableSetOf<String>()
  private val startedRuntimes = mutableSetOf<String>()
  // Runtimes whose JS finished evaluating and registered the threaded runtime
  // entry (signaled via notifyRuntimeReady from @react-native-runtimes/core).
  private val readyRuntimes = mutableSetOf<String>()
  private val dispatchExecutor =
      Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "ThreadedRuntimeDispatch").apply { isDaemon = true }
      }
  private val readyWatchdogExecutor =
      Executors.newSingleThreadScheduledExecutor { runnable ->
        Thread(runnable, "ThreadedRuntimeReadyWatchdog").apply { isDaemon = true }
      }
  private var extraReactPackagesProvider: (() -> List<ReactPackage>)? = null
  private var mainReactPackagesProvider: (() -> List<ReactPackage>)? = null
  @Volatile private var workerJsMainModulePath: String = DEFAULT_WORKER_JS_MAIN_MODULE_PATH

  @JvmStatic
  fun setWorkerJsMainModulePath(path: String) {
    workerJsMainModulePath = path
  }

  @JvmStatic
  fun setMainReactPackagesProvider(provider: (() -> List<ReactPackage>)?) {
    mainReactPackagesProvider = provider
  }

  @JvmStatic
  fun setExtraReactPackagesProvider(provider: (() -> List<ReactPackage>)?) {
    extraReactPackagesProvider = provider
  }

  @OptIn(UnstableReactNativeAPI::class)
  fun createSurface(
      runtimeName: String,
      reactContext: ThemedReactContext,
      appName: String,
      props: android.os.Bundle,
  ): ReactSurface =
      ensureHost(reactContext.applicationContext, reactContext.currentActivity, runtimeName)
          .createSurface(reactContext, appName, props)

  fun preloadRuntime(context: Context, runtimeName: String) = prewarmRuntime(context, runtimeName)

  @JvmOverloads
  @JvmStatic
  fun prewarmRuntime(context: Context, runtimeName: String = DEFAULT_RUNTIME_NAME) {
    prewarmRuntimeWithOptions(
        context,
        runtimeName,
        DEFAULT_RUNTIME_KIND,
        useMainNativeModules = false,
    )
  }

  @JvmStatic
  fun prewarmRuntimeWithOptions(
      context: Context,
      runtimeName: String?,
      kind: String?,
      useMainNativeModules: Boolean,
  ) {
    val normalizedRuntimeName = runtimeName.orDefaultRuntimeName()
    val options =
        RuntimeOptions(
            kind = kind.orDefaultRuntimeKind(),
            useMainNativeModules = useMainNativeModules,
        )
    configureRuntimeOptions(normalizedRuntimeName, options)
    val didReuseHost = synchronized(lock) { hosts.containsKey(normalizedRuntimeName) }
    val appContext = context.applicationContext
    dispatchExecutor.execute {
      val host = ensureHost(appContext, null, normalizedRuntimeName)
      startRuntimeAndFlush(normalizedRuntimeName, host)
      Log.i(
          LOG_TAG,
          "runtime prewarm runtimeName=$normalizedRuntimeName " +
              "kind=${options.kind} useMainNativeModules=${options.useMainNativeModules} " +
              "reused=$didReuseHost active=${runtimeNames()}")
    }
  }

  @JvmOverloads
  @JvmStatic
  fun prewarmBusinessRuntime(
      context: Context,
      runtimeName: String = DEFAULT_BUSINESS_RUNTIME_NAME,
      useMainNativeModules: Boolean = true,
  ) {
    prewarmRuntimeWithOptions(
        context,
        runtimeName,
        BUSINESS_RUNTIME_KIND,
        useMainNativeModules,
    )
  }

  fun destroyRuntime(runtimeName: String) {
    val normalizedRuntimeName = runtimeName.orDefaultRuntimeName()
    val orphanedCalls: List<RuntimeFunctionCallRequest>
    val host =
        synchronized(lock) {
          pendingHeadlessTasks.remove(normalizedRuntimeName)
          orphanedCalls =
              pendingRuntimeFunctionCalls.remove(normalizedRuntimeName)?.toList().orEmpty()
          startingRuntimes.remove(normalizedRuntimeName)
          startedRuntimes.remove(normalizedRuntimeName)
          readyRuntimes.remove(normalizedRuntimeName)
          runtimeOptions.remove(normalizedRuntimeName)
          hosts.remove(normalizedRuntimeName)
        }
    orphanedCalls.forEach { request ->
      completeRuntimeFunctionCall(
          request.callId,
          null,
          "{\"message\":\"Runtime \\\"$normalizedRuntimeName\\\" was destroyed before the call ran\"}")
    }
    host?.destroy("destroyRuntime($normalizedRuntimeName)", null)
  }

  @JvmStatic
  fun runHeadlessTask(
      context: Context,
      runtimeName: String,
      taskName: String,
      payloadJson: String,
  ) = dispatchHeadlessTask(context, runtimeName, taskName, payloadJson)

  @JvmStatic
  fun dispatchHeadlessTask(
      context: Context,
      runtimeName: String?,
      taskName: String,
      payloadJson: String?,
  ) {
    val normalizedRuntimeName = runtimeName.orDefaultRuntimeName()
    val appContext = context.applicationContext
    synchronized(lock) {
      pendingHeadlessTasks
          .getOrPut(normalizedRuntimeName) { mutableListOf() }
          .add(HeadlessTaskRequest(taskName, payloadJson ?: "null"))
    }
    dispatchExecutor.execute {
      val host = ensureHost(appContext, null, normalizedRuntimeName)
      startRuntimeAndFlush(normalizedRuntimeName, host)
    }
    Log.i(
        LOG_TAG,
        "headless task queued runtimeName=$normalizedRuntimeName taskName=$taskName")
  }

  @JvmStatic
  fun callRuntimeFunction(
      context: Context,
      runtimeName: String?,
      functionId: String,
      argsJson: String?,
      promise: Promise,
  ) {
    val normalizedRuntimeName = runtimeName.orDefaultRuntimeName()
    val callId = UUID.randomUUID().toString()
    val appContext = context.applicationContext

    // "main" must route to the application's existing main ReactHost. Creating
    // a new host named "main" (the generic path below) produces a runtime with
    // fresh module state where main-owned values (session bridges, installed
    // handlers, etc.) are missing — calls "succeed" against the wrong runtime.
    // This mirrors the C++ dispatcher registry route, but also covers calls
    // that arrive before the main runtime registered itself there.
    if (normalizedRuntimeName == MAIN_RUNTIME_NAME) {
      val mainHost = (appContext as? ReactApplication)?.reactHost
      if (mainHost != null) {
        val request = RuntimeFunctionCallRequest(functionId, argsJson ?: "[]", callId)
        synchronized(lock) { pendingRuntimeFunctionPromises[callId] = promise }
        dispatchExecutor.execute {
          try {
            invokeRuntimeFunctionCall(mainHost, MAIN_RUNTIME_NAME, request)
          } catch (error: Throwable) {
            completeRuntimeFunctionCall(
                callId,
                null,
                "{\"message\":\"${jsonEscape(error.message ?: "Runtime function dispatch failed")}\"}")
            Log.e(
                LOG_TAG,
                "runtime function dispatch to main host failed functionId=$functionId",
                error,
            )
          }
        }
        Log.i(
            LOG_TAG,
            "runtime function routed to main host functionId=$functionId callId=$callId")
        return
      }
      Log.w(
          LOG_TAG,
          "ReactApplication main host unavailable; falling back to a runtime named \"main\"")
    }

    synchronized(lock) {
      pendingRuntimeFunctionPromises[callId] = promise
      pendingRuntimeFunctionCalls
          .getOrPut(normalizedRuntimeName) { mutableListOf() }
          .add(RuntimeFunctionCallRequest(functionId, argsJson ?: "[]", callId))
    }
    dispatchExecutor.execute {
      val host = ensureHost(appContext, null, normalizedRuntimeName)
      startRuntimeAndFlush(normalizedRuntimeName, host)
    }
    Log.i(
        LOG_TAG,
        "runtime function queued runtimeName=$normalizedRuntimeName functionId=$functionId callId=$callId")
  }

  @JvmStatic
  fun completeRuntimeFunctionCall(callId: String, resultJson: String?, errorJson: String?) {
    val promise = synchronized(lock) { pendingRuntimeFunctionPromises.remove(callId) }
    if (promise == null) {
      Log.w(LOG_TAG, "runtime function completion ignored for unknown callId=$callId")
      return
    }
    if (!errorJson.isNullOrBlank()) {
      promise.reject("ERR_THREADED_RUNTIME_FUNCTION", errorJson)
      return
    }
    promise.resolve(resultJson ?: "null")
  }

  fun destroyAllRuntimes() {
    runtimeNames().forEach { destroyRuntime(it) }
  }

  fun runtimeNames(): List<String> = synchronized(lock) { hosts.keys.toList() }

  @OptIn(UnstableReactNativeAPI::class, FrameworkAPI::class)
  private fun ensureHost(
      context: Context,
      activity: Activity?,
      runtimeName: String,
  ): ReactHost {
    synchronized(lock) { hosts[runtimeName] }?.let {
      resumeHost(it, activity)
      return it
    }

    val componentFactory = ComponentFactory()
    DefaultComponentsRegistry.register(componentFactory)
    val options = runtimeOptionsFor(runtimeName)

    val delegate =
        DefaultReactHostDelegate(
            // Dev-only: dev support derives the Metro URL from this, so debug
            // workers bundle the generated worker entry instead of the app
            // entry. Release loads the embedded app bundle via the loader.
            jsMainModulePath = workerJsMainModulePath,
            jsBundleLoader = ThreadedRuntimeBundleLoader(context),
            reactPackages = buildReactPackages(options),
            jsRuntimeFactory = HermesInstance(),
            // Injects __THREADED_RUNTIME_ENV__ before any script evaluates,
            // regardless of where the bundle comes from.
            bindingsInstaller = ThreadedRuntimeBindingsInstaller(runtimeName, options.kind),
            turboModuleManagerDelegateBuilder = DefaultTurboModuleManagerDelegate.Builder(),
            exceptionHandler = { throw it },
        )

    val nextHost =
        ReactHostImpl(
            context,
            delegate,
            componentFactory,
            true,
            isAppDebuggable(context),
        )

    resumeHost(nextHost, activity)

    synchronized(lock) { hosts[runtimeName] = nextHost }
    return nextHost
  }

  private fun startRuntimeAndFlush(runtimeName: String, host: ReactHost) {
    val shouldStart =
        synchronized(lock) {
          if (startedRuntimes.contains(runtimeName)) {
            false
          } else {
            startingRuntimes.add(runtimeName)
          }
        }

    if (!shouldStart) {
      flushHeadlessTasks(runtimeName, host)
      flushRuntimeFunctionCalls(runtimeName, host)
      return
    }

    dispatchExecutor.execute {
      try {
        val startTask = host.start()
        startTask.waitForCompletion(30, TimeUnit.SECONDS)
        startTask.getError()?.let { throw it }
        synchronized(lock) {
          startingRuntimes.remove(runtimeName)
          startedRuntimes.add(runtimeName)
        }
        scheduleRuntimeReadyWatchdog(runtimeName)
        flushHeadlessTasks(runtimeName, host)
        flushRuntimeFunctionCalls(runtimeName, host)
      } catch (error: Throwable) {
        synchronized(lock) { startingRuntimes.remove(runtimeName) }
        Log.e(LOG_TAG, "runtime start failed runtimeName=$runtimeName", error)
      }
    }
  }

  /**
   * Called from JS (via the bridge module) once the runtime's bundle finished
   * evaluating and @react-native-runtimes/core registered its callable
   * modules. Dispatch into a runtime is held until this fires: the callable
   * modules only exist after the entry evaluated, and dispatching earlier
   * fails on the worker's JS thread without ever settling the caller's
   * promise.
   */
  @JvmStatic
  fun notifyRuntimeReady(runtimeName: String?) {
    val normalizedRuntimeName = runtimeName.orDefaultRuntimeName()
    val host =
        synchronized(lock) {
          if (!readyRuntimes.add(normalizedRuntimeName)) {
            return
          }
          hosts[normalizedRuntimeName]
        }
    Log.i(LOG_TAG, "runtime ready runtimeName=$normalizedRuntimeName")
    if (host != null) {
      flushHeadlessTasks(normalizedRuntimeName, host)
      flushRuntimeFunctionCalls(normalizedRuntimeName, host)
    }
  }

  private fun scheduleRuntimeReadyWatchdog(runtimeName: String) {
    readyWatchdogExecutor.schedule(
        {
          val staleCalls =
              synchronized(lock) {
                if (readyRuntimes.contains(runtimeName) || !hosts.containsKey(runtimeName)) {
                  return@schedule
                }
                pendingHeadlessTasks.remove(runtimeName)
                pendingRuntimeFunctionCalls.remove(runtimeName)?.toList().orEmpty()
              }
          val message =
              "Runtime \"$runtimeName\" started but its JS never signaled ready within " +
                  "${RUNTIME_READY_TIMEOUT_MS / 1000}s. The bundle it evaluated likely does " +
                  "not register the threaded runtime entry (check what the bundler serves " +
                  "for \"$workerJsMainModulePath.bundle\")."
          Log.e(LOG_TAG, message)
          staleCalls.forEach { request ->
            completeRuntimeFunctionCall(
                request.callId, null, "{\"message\":\"${jsonEscape(message)}\"}")
          }
        },
        RUNTIME_READY_TIMEOUT_MS,
        TimeUnit.MILLISECONDS,
    )
  }

  private fun flushHeadlessTasks(runtimeName: String, host: ReactHost) {
    val requests =
        synchronized(lock) {
          if (!startedRuntimes.contains(runtimeName) || !readyRuntimes.contains(runtimeName)) {
            return
          }
          pendingHeadlessTasks.remove(runtimeName)?.toList().orEmpty()
        }
    if (requests.isEmpty()) {
      return
    }

    dispatchExecutor.execute {
      requests.forEach { request ->
        try {
          invokeHeadlessTask(host, runtimeName, request)
        } catch (error: Throwable) {
          Log.e(
              LOG_TAG,
              "headless task dispatch failed runtimeName=$runtimeName taskName=${request.taskName}",
              error,
          )
        }
      }
    }
  }

  private fun flushRuntimeFunctionCalls(runtimeName: String, host: ReactHost) {
    val requests =
        synchronized(lock) {
          if (!startedRuntimes.contains(runtimeName) || !readyRuntimes.contains(runtimeName)) {
            return
          }
          pendingRuntimeFunctionCalls.remove(runtimeName)?.toList().orEmpty()
        }
    if (requests.isEmpty()) {
      return
    }

    dispatchExecutor.execute {
      requests.forEach { request ->
        try {
          invokeRuntimeFunctionCall(host, runtimeName, request)
        } catch (error: Throwable) {
          completeRuntimeFunctionCall(
              request.callId,
              null,
              "{\"message\":\"${jsonEscape(error.message ?: "Runtime function dispatch failed")}\"}")
          Log.e(
              LOG_TAG,
              "runtime function dispatch failed runtimeName=$runtimeName functionId=${request.functionId}",
              error,
          )
        }
      }
    }
  }

  private fun invokeHeadlessTask(
      host: ReactHost,
      runtimeName: String,
      request: HeadlessTaskRequest,
  ) {
    val args =
        Arguments.fromJavaArgs(arrayOf(request.taskName, request.payloadJson, runtimeName))
            as NativeArray
    val method = resolveCallFunctionOnModuleMethod(host)
    val callTask =
        method.invoke(host, HEADLESS_TASK_RUNNER_MODULE, "run", args)
            as? com.facebook.react.interfaces.TaskInterface<*>
    callTask?.waitForCompletion(5, TimeUnit.SECONDS)
    callTask?.getError()?.let { throw it }
    Log.i(
        LOG_TAG,
        "headless task dispatched runtimeName=$runtimeName taskName=${request.taskName}")
  }

  private fun invokeRuntimeFunctionCall(
      host: ReactHost,
      runtimeName: String,
      request: RuntimeFunctionCallRequest,
  ) {
    val args =
        Arguments.fromJavaArgs(
            arrayOf(request.functionId, request.argsJson, request.callId, runtimeName))
            as NativeArray
    val method = resolveCallFunctionOnModuleMethod(host)
    val callTask =
        method.invoke(host, RUNTIME_FUNCTION_RUNNER_MODULE, "run", args)
            as? com.facebook.react.interfaces.TaskInterface<*>
    callTask?.waitForCompletion(5, TimeUnit.SECONDS)
    callTask?.getError()?.let { throw it }
    Log.i(
        LOG_TAG,
        "runtime function dispatched runtimeName=$runtimeName functionId=${request.functionId} callId=${request.callId}")
  }

  private fun resolveCallFunctionOnModuleMethod(host: ReactHost): Method {
    val expectedParameterTypes =
        arrayOf<Class<*>>(String::class.java, String::class.java, NativeArray::class.java)
    var type: Class<*>? = host.javaClass
    while (type != null) {
      val method =
          type.declaredMethods.firstOrNull {
            (it.name == "callFunctionOnModule" || it.name.startsWith("callFunctionOnModule\$")) &&
                it.parameterTypes.contentEquals(expectedParameterTypes)
          }
      if (method != null) {
        method.isAccessible = true
        return method
      }
      type = type.superclass
    }
    throw NoSuchMethodException(
        "${host.javaClass.name}.callFunctionOnModule(String, String, NativeArray)")
  }

  private fun resumeHost(host: ReactHost, activity: Activity?) {
    // Resume even with no Activity: a worker runtime is headless, and until
    // onHostResume moves the host to RESUMED, React Native's JavaTimerManager
    // stays paused (isPaused starts true), so every JS timer on the runtime
    // hangs forever — setTimeout, whatwg-fetch's response dispatch, retry
    // backoffs. Both ReactHostImpl.onHostResume overloads accept a null
    // Activity.
    host.onHostResume(activity, activity as? DefaultHardwareBackBtnHandler)
  }

  private fun buildReactPackages(options: RuntimeOptions): List<ReactPackage> {
    val packages = mutableListOf<ReactPackage>()
    if (options.useMainNativeModules) {
      val mainPackages = mainReactPackagesProvider?.invoke().orEmpty()
      if (mainPackages.isEmpty()) {
        Log.w(
            LOG_TAG,
            "useMainNativeModules=true but no main package provider was configured; " +
                "falling back to the minimal threaded runtime package set")
        packages.add(MainReactPackage())
      } else {
        packages.addAll(mainPackages)
      }
    } else {
      packages.add(MainReactPackage())
    }

    packages.add(ThreadedRuntimePackage())
    packages.addAll(extraReactPackagesProvider?.invoke().orEmpty())
    return packages.distinctBy { it.javaClass.name }
  }

  private fun configureRuntimeOptions(runtimeName: String, options: RuntimeOptions) {
    synchronized(lock) {
      val existingHost = hosts[runtimeName]
      val existingOptions = runtimeOptions[runtimeName]
      if (existingHost != null && existingOptions != null && existingOptions != options) {
        Log.w(
            LOG_TAG,
            "runtime options ignored for already-created runtime runtimeName=$runtimeName " +
                "existing=$existingOptions requested=$options")
        return
      }
      runtimeOptions[runtimeName] = options
    }
  }

  private fun runtimeOptionsFor(runtimeName: String): RuntimeOptions =
      synchronized(lock) { runtimeOptions.getOrPut(runtimeName) { RuntimeOptions() } }

  private fun isAppDebuggable(context: Context): Boolean =
      (context.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0

  private fun String?.orDefaultRuntimeName(): String =
      this?.takeIf { it.isNotBlank() } ?: DEFAULT_RUNTIME_NAME

  private fun String?.orDefaultRuntimeKind(): String =
      this?.takeIf { it.isNotBlank() } ?: DEFAULT_RUNTIME_KIND

  private fun jsonEscape(value: String): String =
      value.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n")
}

// Release-only in practice: with dev support enabled (debug + Metro running),
// ReactHostImpl bypasses the delegate loader and fetches jsMainModulePath from
// Metro instead. __THREADED_RUNTIME_ENV__ comes from
// ThreadedRuntimeBindingsInstaller in both cases, before any script evaluates.
private class ThreadedRuntimeBundleLoader(
    private val context: Context,
) : JSBundleLoader() {
  override fun loadScript(delegate: JSBundleLoaderDelegate): String {
    delegate.loadScriptFromAssets(context.assets, "assets://index.android.bundle", true)
    return "assets://index.android.bundle"
  }
}
