#import <Foundation/Foundation.h>
#import <React/RCTBridgeModule.h>

@protocol RCTReactNativeFactoryDelegate;
@class RCTFabricSurface;

NS_ASSUME_NONNULL_BEGIN

@interface ThreadedRuntime : NSObject <RCTBridgeModule>

+ (void)configureWithReactNativeDelegate:(id<RCTReactNativeFactoryDelegate>)delegate
                           launchOptions:(nullable NSDictionary *)launchOptions;
+ (void)prewarmRuntime:(nullable NSString *)runtimeName;
+ (void)prewarmRuntime:(nullable NSString *)runtimeName
                  kind:(nullable NSString *)kind
  useMainNativeModules:(BOOL)useMainNativeModules;
+ (void)prewarmBusinessRuntime:(nullable NSString *)runtimeName;
+ (void)dispatchHeadlessTaskWithRuntimeName:(nullable NSString *)runtimeName
                                   taskName:(NSString *)taskName
                                payloadJson:(nullable NSString *)payloadJson;
+ (void)runHeadlessTaskWithRuntimeName:(nullable NSString *)runtimeName
                              taskName:(NSString *)taskName
                           payloadJson:(nullable NSString *)payloadJson;
+ (void)callRuntimeFunctionWithRuntimeName:(nullable NSString *)runtimeName
                                functionId:(NSString *)functionId
                                  argsJson:(nullable NSString *)argsJson
                                   resolve:(RCTPromiseResolveBlock)resolve
                                    reject:(RCTPromiseRejectBlock)reject;
+ (void)completeRuntimeFunctionCallWithCallId:(NSString *)callId
                                   resultJson:(nullable NSString *)resultJson
                                    errorJson:(nullable NSString *)errorJson;
+ (void)destroyRuntime:(nullable NSString *)runtimeName;
+ (void)destroyAllRuntimes;
+ (NSArray<NSString *> *)runtimeNames;
+ (RCTFabricSurface *)createSurfaceWithRuntimeName:(nullable NSString *)runtimeName
                                           appName:(nullable NSString *)appName
                                        properties:(NSDictionary *)properties;
+ (BOOL)isRuntimeReadyForSurfaces:(nullable NSString *)runtimeName;
+ (void)ensureRuntimeStarted:(nullable NSString *)runtimeName;

extern NSString *const ThreadedRuntimeReadyNotification;
extern NSString *const ThreadedRuntimeReadyNotificationRuntimeNameKey;

@end

NS_ASSUME_NONNULL_END
