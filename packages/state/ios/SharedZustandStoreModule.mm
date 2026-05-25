#import <Foundation/Foundation.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

#include "SharedZustandStore.hpp"

#include <optional>
#include <string>

using ::margelo::nitro::threadedzustand::SharedZustandStore;

static NSString *const SharedZustandStoreChangedEvent = @"SharedZustandStoreChanged";
static NSString *const SharedZustandRootSubtreeKey = @"__root__";

@interface SharedZustandStoreModule : RCTEventEmitter <RCTBridgeModule>
@end

@implementation SharedZustandStoreModule

RCT_EXPORT_MODULE(SharedZustandStore)

static NSHashTable<SharedZustandStoreModule *> *SharedZustandModules()
{
  static NSHashTable<SharedZustandStoreModule *> *modules;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    modules = [NSHashTable weakObjectsHashTable];
  });
  return modules;
}

static dispatch_queue_t SharedZustandModulesQueue()
{
  static dispatch_queue_t queue;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    queue = dispatch_queue_create("native-compose.threaded-zustand.modules", DISPATCH_QUEUE_SERIAL);
  });
  return queue;
}

static NSString *SharedZustandPersistenceDirectory()
{
  NSArray<NSURL *> *urls =
      [[NSFileManager defaultManager] URLsForDirectory:NSApplicationSupportDirectory inDomains:NSUserDomainMask];
  NSURL *baseURL = urls.firstObject ?: [NSURL fileURLWithPath:NSTemporaryDirectory()];
  NSURL *storeURL = [baseURL URLByAppendingPathComponent:@"threaded-zustand" isDirectory:YES];
  [[NSFileManager defaultManager] createDirectoryAtURL:storeURL
                           withIntermediateDirectories:YES
                                            attributes:nil
                                                 error:nil];
  return storeURL.path;
}

__attribute__((constructor)) static void SharedZustandInstall()
{
  SharedZustandStore::instance().setPersistenceDirectory(
      [SharedZustandPersistenceDirectory() UTF8String]);
}

- (instancetype)init
{
  if (self = [super init]) {
    SharedZustandStore::instance().setPersistenceDirectory(
        [SharedZustandPersistenceDirectory() UTF8String]);
    dispatch_sync(SharedZustandModulesQueue(), ^{
      [SharedZustandModules() addObject:self];
    });
  }
  return self;
}

- (void)invalidate
{
  dispatch_sync(SharedZustandModulesQueue(), ^{
    [SharedZustandModules() removeObject:self];
  });
  [super invalidate];
}

- (NSArray<NSString *> *)supportedEvents
{
  return @[ SharedZustandStoreChangedEvent ];
}

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

+ (void)notifyChangedWithStoreName:(NSString *)storeName
                        subtreeKey:(NSString *)subtreeKey
                         stateJson:(NSString *)stateJson
                          revision:(NSInteger)revision
                            source:(NSString *)source
{
  NSMutableDictionary *payload = [@{
    @"storeName" : storeName,
    @"subtreeKey" : subtreeKey,
    @"revision" : @(revision),
  } mutableCopy];
  payload[@"stateJson"] = stateJson ?: (id)kCFNull;
  payload[@"source"] = source ?: (id)kCFNull;

  dispatch_async(SharedZustandModulesQueue(), ^{
    for (SharedZustandStoreModule *module in SharedZustandModules()) {
      [module sendEventWithName:SharedZustandStoreChangedEvent body:payload];
    }
  });
}

RCT_REMAP_METHOD(getState,
                 getStateWithStoreName:(NSString *)storeName
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  [self getSubtreeStateWithStoreName:storeName subtreeKey:SharedZustandRootSubtreeKey resolver:resolve rejecter:reject];
}

RCT_REMAP_METHOD(getSubtreeState,
                 getSubtreeStateWithStoreName:(NSString *)storeName
                 subtreeKey:(NSString *)subtreeKey
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  auto entry = SharedZustandStore::instance().getState(
      [storeName UTF8String], [subtreeKey UTF8String]);
  resolve(entry.has_value() ? [NSString stringWithUTF8String:entry->stateJson.c_str()] : (id)kCFNull);
}

RCT_REMAP_METHOD(getOrInitState,
                 getOrInitStateWithStoreName:(NSString *)storeName
                 initialJson:(NSString *)initialJson
                 persistKey:(NSString *)persistKey
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  [self getOrInitSubtreeStateWithStoreName:storeName
                                subtreeKey:SharedZustandRootSubtreeKey
                               initialJson:initialJson
                                persistKey:persistKey
                                  resolver:resolve
                                  rejecter:reject];
}

RCT_REMAP_METHOD(getOrInitSubtreeState,
                 getOrInitSubtreeStateWithStoreName:(NSString *)storeName
                 subtreeKey:(NSString *)subtreeKey
                 initialJson:(NSString *)initialJson
                 persistKey:(NSString *)persistKey
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  bool wasMissing =
      !SharedZustandStore::instance()
           .getState([storeName UTF8String], [subtreeKey UTF8String])
           .has_value();
  auto entry = SharedZustandStore::instance().getOrInitState(
      [storeName UTF8String],
      [subtreeKey UTF8String],
      [initialJson UTF8String],
      persistKey ? std::optional<std::string>([persistKey UTF8String]) : std::nullopt);
  resolve(@{
    @"stateJson" : [NSString stringWithUTF8String:entry.stateJson.c_str()],
    @"revision" : @(entry.revision),
    @"restoredFromPersistence" : @(wasMissing && entry.stateJson != std::string([initialJson UTF8String])),
  });
}

RCT_REMAP_METHOD(setState,
                 setStateWithStoreName:(NSString *)storeName
                 stateJson:(NSString *)stateJson
                 source:(NSString *)source
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  [self setSubtreeStateWithStoreName:storeName
                          subtreeKey:SharedZustandRootSubtreeKey
                           stateJson:stateJson
                              source:source
                            resolver:resolve
                            rejecter:reject];
}

RCT_REMAP_METHOD(setSubtreeState,
                 setSubtreeStateWithStoreName:(NSString *)storeName
                 subtreeKey:(NSString *)subtreeKey
                 stateJson:(NSString *)stateJson
                 source:(NSString *)source
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  auto entry = SharedZustandStore::instance().setState(
      [storeName UTF8String], [subtreeKey UTF8String], [stateJson UTF8String]);
  [SharedZustandStoreModule notifyChangedWithStoreName:storeName
                                            subtreeKey:subtreeKey
                                             stateJson:stateJson
                                              revision:entry.revision
                                                source:source];
  resolve(@(entry.revision));
}

RCT_REMAP_METHOD(getRevision,
                 getRevisionWithStoreName:(NSString *)storeName
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  [self getSubtreeRevisionWithStoreName:storeName subtreeKey:SharedZustandRootSubtreeKey resolver:resolve rejecter:reject];
}

RCT_REMAP_METHOD(getSubtreeRevision,
                 getSubtreeRevisionWithStoreName:(NSString *)storeName
                 subtreeKey:(NSString *)subtreeKey
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  resolve(@(SharedZustandStore::instance().getRevision(
      [storeName UTF8String], [subtreeKey UTF8String])));
}

RCT_REMAP_METHOD(clear,
                 clearWithStoreName:(NSString *)storeName
                 source:(NSString *)source
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  [self clearSubtreeWithStoreName:storeName subtreeKey:SharedZustandRootSubtreeKey source:source resolver:resolve rejecter:reject];
}

RCT_REMAP_METHOD(clearSubtree,
                 clearSubtreeWithStoreName:(NSString *)storeName
                 subtreeKey:(NSString *)subtreeKey
                 source:(NSString *)source
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  int revision = SharedZustandStore::instance().clear(
      [storeName UTF8String], [subtreeKey UTF8String]);
  [SharedZustandStoreModule notifyChangedWithStoreName:storeName
                                            subtreeKey:subtreeKey
                                             stateJson:nil
                                              revision:revision
                                                source:source];
  resolve(@(revision));
}

RCT_REMAP_METHOD(setPersistedState,
                 setPersistedStateWithPersistKey:(NSString *)persistKey
                 stateJson:(NSString *)stateJson
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  SharedZustandStore::instance().setPersistedState(
      [persistKey UTF8String], [stateJson UTF8String]);
  resolve(nil);
}

RCT_REMAP_METHOD(clearPersistedState,
                 clearPersistedStateWithPersistKey:(NSString *)persistKey
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  SharedZustandStore::instance().clearPersistedState([persistKey UTF8String]);
  resolve(nil);
}

RCT_REMAP_METHOD(notifyChanged,
                 notifyChangedWithStoreName:(NSString *)storeName
                 subtreeKey:(NSString *)subtreeKey
                 stateJson:(NSString *)stateJson
                 revision:(NSInteger)revision
                 source:(NSString *)source
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  [SharedZustandStoreModule notifyChangedWithStoreName:storeName
                                            subtreeKey:subtreeKey
                                             stateJson:stateJson
                                              revision:revision
                                                source:source];
  resolve(nil);
}

@end
