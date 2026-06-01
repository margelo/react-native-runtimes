#import "ThreadedRuntime.h"

#import <React/RCTConvert.h>
#import <React/RCTFabricSurface.h>
#import <React/RCTLog.h>
#import <React/RCTUtils.h>
#import <React-RCTAppDelegate/RCTAppSetupUtils.h>
#import <React-RCTAppDelegate/RCTReactNativeFactory.h>
#import <ReactCommon/RCTHost.h>
#import <react/renderer/runtimescheduler/RuntimeScheduler.h>
#import <react/renderer/runtimescheduler/RuntimeSchedulerBinding.h>
#import <react/runtime/JSRuntimeFactory.h>
#import <react/runtime/JSRuntimeFactoryCAPI.h>
#import <objc/message.h>
#import <objc/runtime.h>

#include "RuntimeFunctionJsi.h"

NSString *const ThreadedRuntimeReadyNotification = @"ThreadedRuntimeReadyNotification";
NSString *const ThreadedRuntimeReadyNotificationRuntimeNameKey = @"runtimeName";

static NSString *const ThreadedRuntimeDefaultRuntimeName = @"background-list";
static NSString *const ThreadedRuntimeDefaultBusinessRuntimeName = @"business-runtime";
static NSString *const ThreadedRuntimeDefaultHostAppName = @"ThreadedRuntimeHost";
static NSString *const ThreadedRuntimeDefaultRuntimeKind = @"threaded-runtime";
static NSString *const ThreadedRuntimeBusinessRuntimeKind = @"business-runtime";
static NSString *const ThreadedRuntimeHeadlessTaskRunnerModule = @"ThreadedRuntimeHeadlessTaskRunner";
static NSString *const ThreadedRuntimeFunctionRunnerModule = @"ThreadedRuntimeFunctionRunner";

@interface ThreadedRuntime (Private)

+ (void)runtimeDidStartWithRuntimeName:(NSString *)runtimeName host:(RCTHost *)host;

@end

// `setBundleURLProvider:` is implemented by RCTHost on all supported RN versions
// but isn't declared in RN 0.83's public RCTHost.h. Forward-declare it so we can
// call it explicitly after init (RN 0.83's initializer drops the provider param;
// RN 0.85+ stores it — calling the setter is correct/harmless on both).
@interface RCTHost (RNRBundleURLProvider)
- (void)setBundleURLProvider:(RCTHostBundleURLProvider)bundleURLProvider;
@end

@interface ThreadedRuntimeHostDelegate : NSObject <RCTHostDelegate>

- (instancetype)initWithDelegate:(id<RCTReactNativeFactoryDelegate>)delegate runtimeName:(NSString *)runtimeName;
- (instancetype)initWithDelegate:(id<RCTReactNativeFactoryDelegate>)delegate
                      runtimeName:(NSString *)runtimeName
                             kind:(NSString *)kind;

@end

#pragma mark - Expo modules support for secondary runtimes

// objc_setAssociatedObject key: keeps each secondary runtime's Expo AppContext
// alive for as long as its RCTHost.
static char ThreadedRuntimeExpoAppContextKey;

namespace {

// Mirror of `expo::dispatchOnReactScheduler` (ExpoModulesCore's
// EXReactSchedulerDispatch.h). ExpoModulesJSI calls this trampoline to dispatch
// async work onto this runtime's JS thread. Defined here (identical signature
// and behavior) so this pod has no compile-time dependency on ExpoModulesCore —
// Expo documents that "hosts that initialize their own runtime pass a pointer
// to this function as the `dispatch` argument of AppContext.setRuntime".
void ThreadedRuntimeDispatchOnReactScheduler(void *nativeScheduler, int priority, void (^callback)()) noexcept
{
  auto *scheduler = static_cast<facebook::react::RuntimeScheduler *>(nativeScheduler);
  scheduler->scheduleTask(
      static_cast<facebook::react::SchedulerPriority>(priority),
      [callback](facebook::jsi::Runtime &) { callback(); });
}

} // namespace

// Installs Expo modules (`global.expo` + `expo.modules.*`) into a secondary
// runtime by creating a dedicated EXAppContext for its host — the same setup
// ExpoReactNativeFactory performs for the MAIN runtime in
// `host:didInitializeRuntime:` (expo/ios/AppDelegates/ExpoReactNativeFactory.mm).
// Without this, Expo's JSI host only exists on the main runtime and any Expo
// module used from a threaded runtime is a no-op stub.
//
// Done reflectively (NSClassFromString + objc_msgSend) so there is no
// compile-time dependency on ExpoModulesCore; in bare React Native apps the
// EXAppContext class doesn't exist and this is a no-op.
static void ThreadedRuntimeInstallExpoAppContext(RCTHost *host, facebook::jsi::Runtime &runtime)
{
  Class appContextClass = NSClassFromString(@"EXAppContext");
  if (appContextClass == nil) {
    return; // Not an Expo app.
  }
  if (objc_getAssociatedObject(host, &ThreadedRuntimeExpoAppContextKey) != nil) {
    return; // Already installed for this host.
  }

  SEL setRuntimeSel = NSSelectorFromString(@"setRuntime:scheduler:dispatch:");
  SEL registerModulesSel = NSSelectorFromString(@"registerNativeModules");
  id appContext = [[appContextClass alloc] init];
  if (![appContext respondsToSelector:setRuntimeSel] || ![appContext respondsToSelector:registerModulesSel]) {
    RCTLogWarn(
        @"[ThreadedRuntime] EXAppContext exists but its API is not the expected one; "
        @"Expo modules won't be available on secondary runtimes");
    return;
  }

  // Resolve this runtime's React scheduler — exactly like ExpoReactNativeFactory —
  // so ExpoModulesJSI can dispatch async work back onto this runtime's JS thread.
  // If the binding is missing, pass nullptr for both: AppContext falls back to a
  // synchronous scheduler.
  auto binding = facebook::react::RuntimeSchedulerBinding::getBinding(runtime);
  auto scheduler = binding ? binding->getRuntimeScheduler() : nullptr;

  using SetRuntimeFn = void (*)(id, SEL, void *, void *, const void *);
  ((SetRuntimeFn)objc_msgSend)(
      appContext,
      setRuntimeSel,
      (void *)&runtime,
      scheduler ? (void *)scheduler.get() : nullptr,
      scheduler ? (const void *)&ThreadedRuntimeDispatchOnReactScheduler : nullptr);

  // Hand the host to the AppContext (module/view lookups go through it).
  Class hostWrapperClass = NSClassFromString(@"EXHostWrapper");
  SEL initWithHostSel = NSSelectorFromString(@"initWithHost:");
  SEL setHostWrapperSel = NSSelectorFromString(@"setHostWrapper:");
  if (hostWrapperClass != nil && [appContext respondsToSelector:setHostWrapperSel]) {
    id wrapper = ((id (*)(id, SEL, RCTHost *))objc_msgSend)([hostWrapperClass alloc], initWithHostSel, host);
    if (wrapper != nil) {
      ((void (*)(id, SEL, id))objc_msgSend)(appContext, setHostWrapperSel, wrapper);
    }
  }

  // Registers the Expo module definitions; setRuntime above already installed
  // `global.expo` (AppContext.prepareRuntime runs on runtime assignment).
  ((void (*)(id, SEL))objc_msgSend)(appContext, registerModulesSel);

  objc_setAssociatedObject(host, &ThreadedRuntimeExpoAppContextKey, appContext, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  RCTLogInfo(@"[ThreadedRuntime] Installed Expo AppContext on secondary runtime");
}

@implementation ThreadedRuntimeHostDelegate {
  __weak id<RCTReactNativeFactoryDelegate> _delegate;
  NSString *_runtimeName;
  NSString *_kind;
  BOOL _didInitializeRuntime;
}

- (instancetype)initWithDelegate:(id<RCTReactNativeFactoryDelegate>)delegate runtimeName:(NSString *)runtimeName
{
  return [self initWithDelegate:delegate runtimeName:runtimeName kind:ThreadedRuntimeDefaultRuntimeKind];
}

- (instancetype)initWithDelegate:(id<RCTReactNativeFactoryDelegate>)delegate
                      runtimeName:(NSString *)runtimeName
                             kind:(NSString *)kind
{
  if (self = [super init]) {
    _delegate = delegate;
    _runtimeName = [runtimeName copy];
    NSString *resolvedKind = kind.length > 0 ? kind : ThreadedRuntimeDefaultRuntimeKind;
    _kind = [resolvedKind copy];
  }
  return self;
}

- (void)hostDidStart:(RCTHost *)host
{
  if ([_delegate respondsToSelector:@selector(hostDidStart:)]) {
    [_delegate hostDidStart:host];
  }
  [ThreadedRuntime runtimeDidStartWithRuntimeName:_runtimeName host:host];
}

- (NSArray<NSString *> *)unstableModulesRequiringMainQueueSetup
{
  if ([_delegate respondsToSelector:@selector(unstableModulesRequiringMainQueueSetup)]) {
    return [_delegate unstableModulesRequiringMainQueueSetup];
  }

  return @[];
}

- (void)host:(RCTHost *)host didInitializeRuntime:(facebook::jsi::Runtime &)runtime
{
  // Idempotency guard: on RN 0.85+ this object is set as BOTH hostDelegate and
  // runtimeDelegate, so RCTHost invokes this twice. Run setup once.
  if (_didInitializeRuntime) {
    return;
  }
  _didInitializeRuntime = YES;

  auto global = runtime.global();
  global.setProperty(runtime, "global", global);
  global.setProperty(runtime, "globalThis", global);
  global.setProperty(runtime, "_is_it_a_list_env", true);

  auto threadedEnv = facebook::jsi::Object(runtime);
  threadedEnv.setProperty(runtime, "kind", facebook::jsi::String::createFromUtf8(runtime, [_kind UTF8String]));
  threadedEnv.setProperty(runtime, "runtimeName", facebook::jsi::String::createFromUtf8(runtime, [_runtimeName UTF8String]));
  threadedEnv.setProperty(runtime, "isBackgroundRuntime", ![_kind isEqualToString:ThreadedRuntimeDefaultRuntimeKind]);
  threadedEnv.setProperty(runtime, "useMainNativeModules", true);
  threadedEnv.setProperty(runtime, "version", 1);
  global.setProperty(runtime, "__THREADED_RUNTIME_ENV__", threadedEnv);

  auto listEnv = facebook::jsi::Object(runtime);
  listEnv.setProperty(runtime, "kind", facebook::jsi::String::createFromUtf8(runtime, "background-list"));
  listEnv.setProperty(runtime, "runtimeName", facebook::jsi::String::createFromUtf8(runtime, [_runtimeName UTF8String]));
  listEnv.setProperty(runtime, "version", 1);
  global.setProperty(runtime, "__COMPOSE_CHAT_LIST_ENV__", listEnv);

  nativecompose::threadedruntime::installRuntimeFunctionJsi(runtime, [_runtimeName UTF8String]);

  if ([_delegate respondsToSelector:@selector(host:didInitializeRuntime:)]) {
    [(id<RCTHostRuntimeDelegate>)_delegate host:host didInitializeRuntime:runtime];
  }

  // In Expo apps, give this secondary runtime a real `global.expo` (its own
  // EXAppContext) so Expo modules work here too — not just on the main runtime.
  ThreadedRuntimeInstallExpoAppContext(host, runtime);
}

@end

@interface ThreadedRuntimeTurboModuleDelegate : NSObject <RCTTurboModuleManagerDelegate>

- (instancetype)initWithDelegate:(id<RCTReactNativeFactoryDelegate>)delegate;

@end

@implementation ThreadedRuntimeTurboModuleDelegate {
  __weak id<RCTReactNativeFactoryDelegate> _delegate;
}

- (instancetype)initWithDelegate:(id<RCTReactNativeFactoryDelegate>)delegate
{
  if (self = [super init]) {
    _delegate = delegate;
  }
  return self;
}

- (Class)getModuleClassFromName:(const char *)name
{
  if ([_delegate respondsToSelector:@selector(getModuleClassFromName:)]) {
    return [_delegate getModuleClassFromName:name];
  }
  return nullptr;
}

- (id<RCTTurboModule>)getModuleInstanceFromClass:(Class)moduleClass
{
  if ([_delegate respondsToSelector:@selector(getModuleInstanceFromClass:)]) {
    id<RCTTurboModule> module = [_delegate getModuleInstanceFromClass:moduleClass];
    if (module != nil) {
      return module;
    }
  }
  return RCTAppSetupDefaultModuleFromClass(moduleClass, _delegate.dependencyProvider);
}

- (id<RCTModuleProvider>)getModuleProvider:(const char *)name
{
  if ([_delegate respondsToSelector:@selector(getModuleProvider:)]) {
    return [_delegate getModuleProvider:name];
  }
  return nil;
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const std::string &)name
                                                      jsInvoker:(std::shared_ptr<facebook::react::CallInvoker>)jsInvoker
{
  if ([_delegate respondsToSelector:@selector(getTurboModule:jsInvoker:)]) {
    return [_delegate getTurboModule:name jsInvoker:jsInvoker];
  }
  return nullptr;
}

- (NSArray<id<RCTBridgeModule>> *)extraModulesForBridge:(RCTBridge *)bridge
{
  if ([_delegate respondsToSelector:@selector(extraModulesForBridge:)]) {
    return [_delegate extraModulesForBridge:bridge];
  }
  return @[];
}

@end

@implementation ThreadedRuntime

RCT_EXPORT_MODULE()

static NSMutableDictionary<NSString *, RCTHost *> *ThreadedRuntimeHosts()
{
  static NSMutableDictionary<NSString *, RCTHost *> *hosts;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    hosts = [NSMutableDictionary new];
  });
  return hosts;
}

static NSMutableDictionary<NSString *, ThreadedRuntimeHostDelegate *> *ThreadedRuntimeHostDelegates()
{
  static NSMutableDictionary<NSString *, ThreadedRuntimeHostDelegate *> *delegates;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    delegates = [NSMutableDictionary new];
  });
  return delegates;
}

static NSMutableDictionary<NSString *, ThreadedRuntimeTurboModuleDelegate *> *ThreadedRuntimeTurboModuleDelegates()
{
  static NSMutableDictionary<NSString *, ThreadedRuntimeTurboModuleDelegate *> *delegates;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    delegates = [NSMutableDictionary new];
  });
  return delegates;
}

static NSMutableDictionary<NSString *, NSString *> *ThreadedRuntimeKinds()
{
  static NSMutableDictionary<NSString *, NSString *> *kinds;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    kinds = [NSMutableDictionary new];
  });
  return kinds;
}

static NSMutableDictionary<NSString *, NSMutableArray<NSDictionary<NSString *, NSString *> *> *> *ThreadedRuntimePendingHeadlessTasks()
{
  static NSMutableDictionary<NSString *, NSMutableArray<NSDictionary<NSString *, NSString *> *> *> *tasks;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    tasks = [NSMutableDictionary new];
  });
  return tasks;
}

static NSMutableDictionary<NSString *, NSMutableArray<NSDictionary<NSString *, NSString *> *> *> *ThreadedRuntimePendingFunctionCalls()
{
  static NSMutableDictionary<NSString *, NSMutableArray<NSDictionary<NSString *, NSString *> *> *> *calls;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    calls = [NSMutableDictionary new];
  });
  return calls;
}

static NSMutableDictionary<NSString *, NSMutableArray<RCTFabricSurface *> *> *ThreadedRuntimePendingSurfaces()
{
  static NSMutableDictionary<NSString *, NSMutableArray<RCTFabricSurface *> *> *surfaces;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    surfaces = [NSMutableDictionary new];
  });
  return surfaces;
}

static NSMutableDictionary<NSString *, RCTPromiseResolveBlock> *ThreadedRuntimeFunctionResolves()
{
  static NSMutableDictionary<NSString *, RCTPromiseResolveBlock> *resolves;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    resolves = [NSMutableDictionary new];
  });
  return resolves;
}

static NSMutableDictionary<NSString *, RCTPromiseRejectBlock> *ThreadedRuntimeFunctionRejects()
{
  static NSMutableDictionary<NSString *, RCTPromiseRejectBlock> *rejects;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    rejects = [NSMutableDictionary new];
  });
  return rejects;
}

static NSMutableSet<NSString *> *ThreadedRuntimeStartingRuntimeNames()
{
  static NSMutableSet<NSString *> *runtimeNames;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    runtimeNames = [NSMutableSet new];
  });
  return runtimeNames;
}

static NSMutableSet<NSString *> *ThreadedRuntimeStartedRuntimeNames()
{
  static NSMutableSet<NSString *> *runtimeNames;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    runtimeNames = [NSMutableSet new];
  });
  return runtimeNames;
}

static NSMutableSet<NSString *> *ThreadedRuntimeBundleLoadedRuntimeNames()
{
  static NSMutableSet<NSString *> *runtimeNames;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    runtimeNames = [NSMutableSet new];
  });
  return runtimeNames;
}

static dispatch_queue_t ThreadedRuntimeQueue()
{
  static dispatch_queue_t queue;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    queue = dispatch_queue_create("native-compose.threaded-runtime.prewarm", DISPATCH_QUEUE_SERIAL);
  });
  return queue;
}

static id<RCTReactNativeFactoryDelegate> configuredDelegate;
static NSDictionary *configuredLaunchOptions;

+ (BOOL)requiresMainQueueSetup
{
  return YES;
}

+ (void)configureWithReactNativeDelegate:(id<RCTReactNativeFactoryDelegate>)delegate
                           launchOptions:(NSDictionary *)launchOptions
{
  configuredDelegate = delegate;
  configuredLaunchOptions = [launchOptions copy];
}

+ (void)prewarmRuntime:(NSString *)runtimeName
{
  [self prewarmRuntime:runtimeName kind:ThreadedRuntimeDefaultRuntimeKind useMainNativeModules:NO];
}

+ (void)prewarmRuntime:(NSString *)runtimeName
                  kind:(NSString *)kind
  useMainNativeModules:(BOOL)useMainNativeModules
{
  NSString *normalizedRuntimeName = [self normalizeRuntimeName:runtimeName];
  NSString *normalizedKind = [self normalizeRuntimeKind:kind];
  [self configureRuntimeKind:normalizedKind runtimeName:normalizedRuntimeName];
  (void)useMainNativeModules;
  BOOL reused = NO;
  @synchronized(self) {
    reused = ThreadedRuntimeHosts()[normalizedRuntimeName] != nil;
  }
  dispatch_async(ThreadedRuntimeQueue(), ^{
    RCTHost *host = [self ensureHostWithRuntimeName:normalizedRuntimeName];
    [self startRuntimeAndFlushWithRuntimeName:normalizedRuntimeName host:host];
    NSArray<NSString *> *activeRuntimeNames = [self runtimeNames];
    NSLog(
        @"[ThreadedRuntime] runtime prewarm runtimeName=%@ kind=%@ useMainNativeModules=true reused=%@ active=%@",
        normalizedRuntimeName,
        normalizedKind,
        reused ? @"true" : @"false",
        activeRuntimeNames);
    RCTLogInfo(
        @"[ThreadedRuntime] runtime prewarm runtimeName=%@ kind=%@ useMainNativeModules=true reused=%@ active=%@",
        normalizedRuntimeName,
        normalizedKind,
        reused ? @"true" : @"false",
        activeRuntimeNames);
  });
}

+ (void)prewarmBusinessRuntime:(NSString *)runtimeName
{
  [self prewarmRuntime:runtimeName ?: ThreadedRuntimeDefaultBusinessRuntimeName
                  kind:ThreadedRuntimeBusinessRuntimeKind
  useMainNativeModules:YES];
}

+ (void)dispatchHeadlessTaskWithRuntimeName:(NSString *)runtimeName
                                   taskName:(NSString *)taskName
                                payloadJson:(NSString *)payloadJson
{
  NSString *normalizedRuntimeName = [self normalizeRuntimeName:runtimeName];
  NSDictionary<NSString *, NSString *> *task = @{
    @"taskName" : taskName ?: @"",
    @"payloadJson" : payloadJson ?: @"null",
  };

  @synchronized(self) {
    NSMutableArray<NSDictionary<NSString *, NSString *> *> *pending =
        ThreadedRuntimePendingHeadlessTasks()[normalizedRuntimeName];
    if (pending == nil) {
      pending = [NSMutableArray new];
      ThreadedRuntimePendingHeadlessTasks()[normalizedRuntimeName] = pending;
    }
    [pending addObject:task];
  }

  dispatch_async(ThreadedRuntimeQueue(), ^{
    RCTHost *host = [self ensureHostWithRuntimeName:normalizedRuntimeName];
    [self startRuntimeAndFlushWithRuntimeName:normalizedRuntimeName host:host];
  });
  NSLog(
      @"[ThreadedRuntime] headless task queued runtimeName=%@ taskName=%@",
      normalizedRuntimeName,
      taskName);
  RCTLogInfo(
      @"[ThreadedRuntime] headless task queued runtimeName=%@ taskName=%@",
      normalizedRuntimeName,
      taskName);
}

+ (void)callRuntimeFunctionWithRuntimeName:(NSString *)runtimeName
                                functionId:(NSString *)functionId
                                  argsJson:(NSString *)argsJson
                                   resolve:(RCTPromiseResolveBlock)resolve
                                    reject:(RCTPromiseRejectBlock)reject
{
  NSString *normalizedRuntimeName = [self normalizeRuntimeName:runtimeName];
  NSString *callId = [NSUUID UUID].UUIDString;
  NSDictionary<NSString *, NSString *> *call = @{
    @"functionId" : functionId ?: @"",
    @"argsJson" : argsJson ?: @"[]",
    @"callId" : callId,
  };

  @synchronized(self) {
    ThreadedRuntimeFunctionResolves()[callId] = [resolve copy];
    ThreadedRuntimeFunctionRejects()[callId] = [reject copy];
    NSMutableArray<NSDictionary<NSString *, NSString *> *> *pending =
        ThreadedRuntimePendingFunctionCalls()[normalizedRuntimeName];
    if (pending == nil) {
      pending = [NSMutableArray new];
      ThreadedRuntimePendingFunctionCalls()[normalizedRuntimeName] = pending;
    }
    [pending addObject:call];
  }

  dispatch_async(ThreadedRuntimeQueue(), ^{
    RCTHost *host = [self ensureHostWithRuntimeName:normalizedRuntimeName];
    [self startRuntimeAndFlushWithRuntimeName:normalizedRuntimeName host:host];
  });
  NSLog(
      @"[ThreadedRuntime] runtime function queued runtimeName=%@ functionId=%@ callId=%@",
      normalizedRuntimeName,
      functionId,
      callId);
}

+ (void)completeRuntimeFunctionCallWithCallId:(NSString *)callId
                                   resultJson:(NSString *)resultJson
                                    errorJson:(NSString *)errorJson
{
  RCTPromiseResolveBlock resolve = nil;
  RCTPromiseRejectBlock reject = nil;
  @synchronized(self) {
    resolve = ThreadedRuntimeFunctionResolves()[callId];
    reject = ThreadedRuntimeFunctionRejects()[callId];
    [ThreadedRuntimeFunctionResolves() removeObjectForKey:callId];
    [ThreadedRuntimeFunctionRejects() removeObjectForKey:callId];
  }

  if (resolve == nil || reject == nil) {
    RCTLogWarn(@"[ThreadedRuntime] runtime function completion ignored for unknown callId=%@", callId);
    return;
  }

  if (errorJson.length > 0) {
    reject(@"ERR_THREADED_RUNTIME_FUNCTION", errorJson, nil);
    return;
  }

  resolve(resultJson ?: @"null");
}

+ (void)runHeadlessTaskWithRuntimeName:(NSString *)runtimeName
                              taskName:(NSString *)taskName
                           payloadJson:(NSString *)payloadJson
{
  [self dispatchHeadlessTaskWithRuntimeName:runtimeName taskName:taskName payloadJson:payloadJson];
}

+ (void)destroyRuntime:(NSString *)runtimeName
{
  NSString *normalizedRuntimeName = [self normalizeRuntimeName:runtimeName];
  @synchronized(self) {
    [ThreadedRuntimePendingHeadlessTasks() removeObjectForKey:normalizedRuntimeName];
    [ThreadedRuntimePendingFunctionCalls() removeObjectForKey:normalizedRuntimeName];
    [ThreadedRuntimePendingSurfaces() removeObjectForKey:normalizedRuntimeName];
    [ThreadedRuntimeStartingRuntimeNames() removeObject:normalizedRuntimeName];
    [ThreadedRuntimeStartedRuntimeNames() removeObject:normalizedRuntimeName];
    [ThreadedRuntimeBundleLoadedRuntimeNames() removeObject:normalizedRuntimeName];
  }
  [ThreadedRuntimeHosts() removeObjectForKey:normalizedRuntimeName];
  [ThreadedRuntimeHostDelegates() removeObjectForKey:normalizedRuntimeName];
  [ThreadedRuntimeTurboModuleDelegates() removeObjectForKey:normalizedRuntimeName];
  [ThreadedRuntimeKinds() removeObjectForKey:normalizedRuntimeName];
  NSLog(@"[ThreadedRuntime] runtime destroy runtimeName=%@", normalizedRuntimeName);
  RCTLogInfo(@"[ThreadedRuntime] runtime destroy runtimeName=%@", normalizedRuntimeName);
}

+ (void)destroyAllRuntimes
{
  [ThreadedRuntimeHosts() removeAllObjects];
  [ThreadedRuntimeHostDelegates() removeAllObjects];
  [ThreadedRuntimeTurboModuleDelegates() removeAllObjects];
  [ThreadedRuntimeKinds() removeAllObjects];
  @synchronized(self) {
    [ThreadedRuntimePendingHeadlessTasks() removeAllObjects];
    [ThreadedRuntimePendingFunctionCalls() removeAllObjects];
    [ThreadedRuntimePendingSurfaces() removeAllObjects];
    [ThreadedRuntimeStartingRuntimeNames() removeAllObjects];
    [ThreadedRuntimeStartedRuntimeNames() removeAllObjects];
    [ThreadedRuntimeBundleLoadedRuntimeNames() removeAllObjects];
  }
  NSLog(@"[ThreadedRuntime] runtime destroyAll");
  RCTLogInfo(@"[ThreadedRuntime] runtime destroyAll");
}

+ (NSArray<NSString *> *)runtimeNames
{
  @synchronized(self) {
    return [ThreadedRuntimeHosts().allKeys copy];
  }
}

+ (RCTFabricSurface *)createSurfaceWithRuntimeName:(NSString *)runtimeName
                                           appName:(NSString *)appName
                                        properties:(NSDictionary *)properties
{
  NSString *normalizedRuntimeName = [self normalizeRuntimeName:runtimeName];
  NSString *normalizedAppName = appName.length > 0 ? appName : ThreadedRuntimeDefaultHostAppName;
  RCTHost *host = [self ensureHostWithRuntimeName:normalizedRuntimeName];
  [self startRuntimeAndFlushWithRuntimeName:normalizedRuntimeName host:host];
  RCTFabricSurface *surface =
      [[RCTFabricSurface alloc] initWithSurfacePresenter:host.surfacePresenter
                                              moduleName:normalizedAppName
                                       initialProperties:properties ?: @{}];

  BOOL startNow = NO;
  @synchronized(self) {
    if ([ThreadedRuntimeBundleLoadedRuntimeNames() containsObject:normalizedRuntimeName]) {
      startNow = YES;
    } else {
      NSMutableArray<RCTFabricSurface *> *pending =
          ThreadedRuntimePendingSurfaces()[normalizedRuntimeName];
      if (pending == nil) {
        pending = [NSMutableArray new];
        ThreadedRuntimePendingSurfaces()[normalizedRuntimeName] = pending;
      }
      [pending addObject:surface];
    }
  }

  if (startNow) {
    dispatch_async(dispatch_get_main_queue(), ^{
      [surface start];
    });
  }

  return surface;
}

+ (void)startRuntimeAndFlushWithRuntimeName:(NSString *)runtimeName host:(RCTHost *)host
{
  dispatch_async(dispatch_get_main_queue(), ^{
    BOOL shouldStart = NO;
    @synchronized(self) {
      if ([ThreadedRuntimeStartedRuntimeNames() containsObject:runtimeName]) {
        [self flushHeadlessTasksWithRuntimeName:runtimeName host:host];
        [self flushRuntimeFunctionCallsWithRuntimeName:runtimeName host:host];
        return;
      }
      if (![ThreadedRuntimeStartingRuntimeNames() containsObject:runtimeName]) {
        [ThreadedRuntimeStartingRuntimeNames() addObject:runtimeName];
        shouldStart = YES;
      }
    }

    if (shouldStart) {
      @try {
        [host start];
      } @catch (NSException *exception) {
        @synchronized(self) {
          [ThreadedRuntimeStartingRuntimeNames() removeObject:runtimeName];
        }
        NSLog(
            @"[ThreadedRuntime] runtime start failed runtimeName=%@ reason=%@",
            runtimeName,
            exception.reason);
        RCTLogError(
            @"[ThreadedRuntime] runtime start failed runtimeName=%@ reason=%@",
            runtimeName,
            exception.reason);
      }
    }
  });
}

+ (void)runtimeDidStartWithRuntimeName:(NSString *)runtimeName host:(RCTHost *)host
{
  NSString *normalizedRuntimeName = [self normalizeRuntimeName:runtimeName];
  @synchronized(self) {
    [ThreadedRuntimeStartingRuntimeNames() removeObject:normalizedRuntimeName];
    [ThreadedRuntimeStartedRuntimeNames() addObject:normalizedRuntimeName];
  }
  [self flushHeadlessTasksWithRuntimeName:normalizedRuntimeName host:host];
  [self flushRuntimeFunctionCallsWithRuntimeName:normalizedRuntimeName host:host];
}

+ (void)notifyRuntimeReadyWithRuntimeName:(NSString *)runtimeName
{
  NSString *normalizedRuntimeName = [self normalizeRuntimeName:runtimeName];
  BOOL alreadyReady = NO;
  @synchronized(self) {
    alreadyReady = [ThreadedRuntimeBundleLoadedRuntimeNames() containsObject:normalizedRuntimeName];
    if (!alreadyReady) {
      [ThreadedRuntimeBundleLoadedRuntimeNames() addObject:normalizedRuntimeName];
    }
  }
  if (alreadyReady) {
    return;
  }
  [self flushPendingSurfacesWithRuntimeName:normalizedRuntimeName];
  dispatch_async(dispatch_get_main_queue(), ^{
    [[NSNotificationCenter defaultCenter]
        postNotificationName:ThreadedRuntimeReadyNotification
                      object:nil
                    userInfo:@{ThreadedRuntimeReadyNotificationRuntimeNameKey : normalizedRuntimeName}];
  });
}

+ (BOOL)isRuntimeReadyForSurfaces:(NSString *)runtimeName
{
  NSString *normalizedRuntimeName = [self normalizeRuntimeName:runtimeName];
  @synchronized(self) {
    return [ThreadedRuntimeBundleLoadedRuntimeNames() containsObject:normalizedRuntimeName];
  }
}

+ (void)ensureRuntimeStarted:(NSString *)runtimeName
{
  NSString *normalizedRuntimeName = [self normalizeRuntimeName:runtimeName];
  [self configureRuntimeKind:[self runtimeKindForRuntimeName:normalizedRuntimeName]
                 runtimeName:normalizedRuntimeName];
  dispatch_async(ThreadedRuntimeQueue(), ^{
    RCTHost *host = [self ensureHostWithRuntimeName:normalizedRuntimeName];
    [self startRuntimeAndFlushWithRuntimeName:normalizedRuntimeName host:host];
  });
}

+ (void)flushPendingSurfacesWithRuntimeName:(NSString *)runtimeName
{
  NSArray<RCTFabricSurface *> *surfaces;
  @synchronized(self) {
    surfaces = [ThreadedRuntimePendingSurfaces()[runtimeName] copy];
    [ThreadedRuntimePendingSurfaces() removeObjectForKey:runtimeName];
  }

  for (RCTFabricSurface *surface in surfaces) {
    dispatch_async(dispatch_get_main_queue(), ^{
      [surface start];
    });
  }
}

+ (void)flushHeadlessTasksWithRuntimeName:(NSString *)runtimeName host:(RCTHost *)host
{
  NSArray<NSDictionary<NSString *, NSString *> *> *tasks;
  @synchronized(self) {
    if (![ThreadedRuntimeStartedRuntimeNames() containsObject:runtimeName]) {
      return;
    }
    tasks = [ThreadedRuntimePendingHeadlessTasks()[runtimeName] copy];
    [ThreadedRuntimePendingHeadlessTasks() removeObjectForKey:runtimeName];
  }

  for (NSDictionary<NSString *, NSString *> *task in tasks) {
    NSString *taskName = task[@"taskName"] ?: @"";
    NSString *payloadJson = task[@"payloadJson"] ?: @"null";
    [host callFunctionOnJSModule:ThreadedRuntimeHeadlessTaskRunnerModule
                          method:@"run"
                            args:@[ taskName, payloadJson, runtimeName ]];
    NSLog(
        @"[ThreadedRuntime] headless task dispatched runtimeName=%@ taskName=%@",
        runtimeName,
        taskName);
    RCTLogInfo(
        @"[ThreadedRuntime] headless task dispatched runtimeName=%@ taskName=%@",
        runtimeName,
        taskName);
  }
}

+ (void)flushRuntimeFunctionCallsWithRuntimeName:(NSString *)runtimeName host:(RCTHost *)host
{
  NSArray<NSDictionary<NSString *, NSString *> *> *calls;
  @synchronized(self) {
    if (![ThreadedRuntimeStartedRuntimeNames() containsObject:runtimeName]) {
      return;
    }
    calls = [ThreadedRuntimePendingFunctionCalls()[runtimeName] copy];
    [ThreadedRuntimePendingFunctionCalls() removeObjectForKey:runtimeName];
  }

  for (NSDictionary<NSString *, NSString *> *call in calls) {
    NSString *functionId = call[@"functionId"] ?: @"";
    NSString *argsJson = call[@"argsJson"] ?: @"[]";
    NSString *callId = call[@"callId"] ?: @"";
    [host callFunctionOnJSModule:ThreadedRuntimeFunctionRunnerModule
                          method:@"run"
                            args:@[ functionId, argsJson, callId, runtimeName ]];
    RCTLogInfo(
        @"[ThreadedRuntime] runtime function dispatched runtimeName=%@ functionId=%@ callId=%@",
        runtimeName,
        functionId,
        callId);
  }
}

+ (RCTHost *)ensureHostWithRuntimeName:(NSString *)runtimeName
{
  @synchronized(self) {
    RCTHost *existingHost = ThreadedRuntimeHosts()[runtimeName];
    if (existingHost != nil) {
      return existingHost;
    }
  }

  id<RCTReactNativeFactoryDelegate> delegate = configuredDelegate;
  if (delegate == nil) {
    RCTFatal(RCTErrorWithMessage(@"ThreadedRuntime.configureWithReactNativeDelegate must be called before creating iOS threaded runtimes."));
  }

  ThreadedRuntimeHostDelegate *hostDelegate =
      [[ThreadedRuntimeHostDelegate alloc] initWithDelegate:delegate
                                                runtimeName:runtimeName
                                                       kind:[self runtimeKindForRuntimeName:runtimeName]];
  ThreadedRuntimeTurboModuleDelegate *turboModuleDelegate =
      [[ThreadedRuntimeTurboModuleDelegate alloc] initWithDelegate:delegate];
  __weak id<RCTReactNativeFactoryDelegate> weakDelegate = delegate;
  RCTHostBundleURLProvider bundleURLProvider = ^NSURL *_Nullable {
    return [weakDelegate bundleURL];
  };
  RCTHost *host = [[RCTHost alloc] initWithBundleURLProvider:bundleURLProvider
                                      hostDelegate:hostDelegate
                        turboModuleManagerDelegate:turboModuleDelegate
                                  jsEngineProvider:^std::shared_ptr<facebook::react::JSRuntimeFactory>() {
                                    JSRuntimeFactoryRef factory = [weakDelegate createJSRuntimeFactory];
                                    return std::shared_ptr<facebook::react::JSRuntimeFactory>(
                                        reinterpret_cast<facebook::react::JSRuntimeFactory *>(factory),
                                        &js_runtime_factory_destroy);
                                  }
                                     launchOptions:configuredLaunchOptions];
  // RN 0.83's RCTHost initializer drops the bundle URL provider (only RN 0.85+
  // stores it in init), so set it explicitly — otherwise the secondary runtime
  // loads with a nil bundle URL ("No script URL provided").
  [host setBundleURLProvider:bundleURLProvider];
  // RN 0.83 dispatches `host:didInitializeRuntime:` ONLY to runtimeDelegate
  // (RN 0.85+ also calls it on hostDelegate). That callback sets
  // __THREADED_RUNTIME_ENV__, which the index gate needs to load the threaded
  // entry (and register ThreadedRuntimeFunctionRunner). The hostDelegate already
  // implements it; reuse it as runtimeDelegate (the _didInitializeRuntime guard
  // makes the resulting double-call on RN 0.85 a no-op).
  host.runtimeDelegate = (id<RCTHostRuntimeDelegate>)hostDelegate;

  @synchronized(self) {
    RCTHost *existingHost = ThreadedRuntimeHosts()[runtimeName];
    if (existingHost != nil) {
      return existingHost;
    }
    ThreadedRuntimeHosts()[runtimeName] = host;
    ThreadedRuntimeHostDelegates()[runtimeName] = hostDelegate;
    ThreadedRuntimeTurboModuleDelegates()[runtimeName] = turboModuleDelegate;
    return host;
  }
}

+ (NSString *)normalizeRuntimeName:(NSString *)runtimeName
{
  return runtimeName.length > 0 ? runtimeName : ThreadedRuntimeDefaultRuntimeName;
}

+ (NSString *)normalizeRuntimeKind:(NSString *)kind
{
  return kind.length > 0 ? kind : ThreadedRuntimeDefaultRuntimeKind;
}

+ (NSString *)runtimeKindForRuntimeName:(NSString *)runtimeName
{
  return ThreadedRuntimeKinds()[runtimeName] ?: ThreadedRuntimeDefaultRuntimeKind;
}

+ (void)configureRuntimeKind:(NSString *)kind runtimeName:(NSString *)runtimeName
{
  RCTHost *existingHost = ThreadedRuntimeHosts()[runtimeName];
  NSString *existingKind = ThreadedRuntimeKinds()[runtimeName];
  if (existingHost != nil && existingKind.length > 0 && ![existingKind isEqualToString:kind]) {
    RCTLogWarn(
        @"[ThreadedRuntime] runtime kind ignored for already-created runtime runtimeName=%@ existing=%@ requested=%@",
        runtimeName,
        existingKind,
        kind);
    return;
  }
  ThreadedRuntimeKinds()[runtimeName] = kind;
}

RCT_EXPORT_METHOD(preloadRuntime
                  : (NSString *)runtimeName resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)
{
  [self prewarmRuntime:runtimeName resolver:resolve rejecter:reject];
}

RCT_EXPORT_METHOD(prewarmRuntime
                  : (NSString *)runtimeName resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)
{
  @try {
    [ThreadedRuntime prewarmRuntime:runtimeName];
    resolve(nil);
  } @catch (NSException *exception) {
    reject(@"ERR_THREADED_RUNTIME_PREWARM", exception.reason, nil);
  }
}

RCT_EXPORT_METHOD(prewarmRuntimeWithOptions
                  : (NSString *)runtimeName kind
                  : (NSString *)kind useMainNativeModules
                  : (BOOL)useMainNativeModules resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)
{
  @try {
    [ThreadedRuntime prewarmRuntime:runtimeName kind:kind useMainNativeModules:useMainNativeModules];
    resolve(nil);
  } @catch (NSException *exception) {
    reject(@"ERR_THREADED_RUNTIME_PREWARM", exception.reason, nil);
  }
}

RCT_EXPORT_METHOD(runHeadlessTask
                  : (NSString *)runtimeName taskName
                  : (NSString *)taskName payloadJson
                  : (NSString *)payloadJson resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)
{
  @try {
    [ThreadedRuntime runHeadlessTaskWithRuntimeName:runtimeName taskName:taskName payloadJson:payloadJson];
    resolve(nil);
  } @catch (NSException *exception) {
    reject(@"ERR_THREADED_RUNTIME_HEADLESS_TASK", exception.reason, nil);
  }
}

RCT_EXPORT_METHOD(dispatchHeadlessTask
                  : (NSString *)runtimeName taskName
                  : (NSString *)taskName payloadJson
                  : (NSString *)payloadJson resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)
{
  @try {
    [ThreadedRuntime dispatchHeadlessTaskWithRuntimeName:runtimeName taskName:taskName payloadJson:payloadJson];
    resolve(nil);
  } @catch (NSException *exception) {
    reject(@"ERR_THREADED_RUNTIME_HEADLESS_TASK", exception.reason, nil);
  }
}

RCT_EXPORT_METHOD(callRuntimeFunction
                  : (NSString *)runtimeName functionId
                  : (NSString *)functionId argsJson
                  : (NSString *)argsJson resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)
{
  @try {
    [ThreadedRuntime callRuntimeFunctionWithRuntimeName:runtimeName
                                            functionId:functionId
                                              argsJson:argsJson
                                               resolve:resolve
                                                reject:reject];
  } @catch (NSException *exception) {
    reject(@"ERR_THREADED_RUNTIME_FUNCTION", exception.reason, nil);
  }
}

RCT_EXPORT_METHOD(completeRuntimeFunctionCall
                  : (NSString *)callId resultJson
                  : (NSString *)resultJson errorJson
                  : (NSString *)errorJson resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)
{
  [ThreadedRuntime completeRuntimeFunctionCallWithCallId:callId
                                             resultJson:resultJson
                                              errorJson:errorJson];
  resolve(nil);
}

RCT_EXPORT_METHOD(notifyRuntimeReady
                  : (NSString *)runtimeName resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)
{
  [ThreadedRuntime notifyRuntimeReadyWithRuntimeName:runtimeName];
  resolve(nil);
}

RCT_EXPORT_METHOD(destroyRuntime
                  : (NSString *)runtimeName resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)
{
  [ThreadedRuntime destroyRuntime:runtimeName];
  resolve(nil);
}

RCT_EXPORT_METHOD(destroyAllRuntimes
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)
{
  [ThreadedRuntime destroyAllRuntimes];
  resolve(nil);
}

RCT_EXPORT_METHOD(getRuntimeNames
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)
{
  resolve([ThreadedRuntime runtimeNames]);
}

@end
