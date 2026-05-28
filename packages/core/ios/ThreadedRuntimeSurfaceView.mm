#import "ThreadedRuntimeSurfaceView.h"

#import <React/RCTFabricSurface.h>
#import <React/RCTLog.h>
#import <React/RCTSurfaceHostingView.h>
#import <React/RCTSurfaceSizeMeasureMode.h>

#import "ThreadedRuntime.h"

static NSString *const ThreadedRuntimeSurfaceDefaultRuntimeName = @"background-list";
static NSString *const ThreadedRuntimeSurfaceDefaultHostAppName = @"ThreadedRuntimeHost";

@implementation ThreadedRuntimeSurfaceView {
  RCTFabricSurface *_surface;
  RCTSurfaceHostingView *_surfaceView;
  BOOL _observingRuntimeReady;
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    _appName = ThreadedRuntimeSurfaceDefaultHostAppName;
    _blockStatus = @"idle";
    _componentName = @"";
    _initialPropsJson = @"{}";
    _mode = @"";
    _runtimeName = ThreadedRuntimeSurfaceDefaultRuntimeName;
    _surfaceKey = @"";
    self.backgroundColor = UIColor.clearColor;
  }
  return self;
}

- (void)dealloc
{
  [self stopObservingRuntimeReady];
}

- (void)didMoveToWindow
{
  [super didMoveToWindow];
  if (self.window != nil) {
    [self ensureSurface];
  } else {
    [self stopSurface];
    [self stopObservingRuntimeReady];
  }
}

- (void)startObservingRuntimeReady
{
  if (_observingRuntimeReady) {
    return;
  }
  _observingRuntimeReady = YES;
  [[NSNotificationCenter defaultCenter] addObserver:self
                                           selector:@selector(handleRuntimeReady:)
                                               name:ThreadedRuntimeReadyNotification
                                             object:nil];
}

- (void)stopObservingRuntimeReady
{
  if (!_observingRuntimeReady) {
    return;
  }
  _observingRuntimeReady = NO;
  [[NSNotificationCenter defaultCenter] removeObserver:self
                                                  name:ThreadedRuntimeReadyNotification
                                                object:nil];
}

- (void)handleRuntimeReady:(NSNotification *)note
{
  NSString *readyRuntimeName = note.userInfo[ThreadedRuntimeReadyNotificationRuntimeNameKey];
  if (![readyRuntimeName isEqualToString:_runtimeName]) {
    return;
  }
  [self stopObservingRuntimeReady];
  if (self.window != nil && _surface == nil) {
    [self ensureSurface];
  }
}

- (void)layoutSubviews
{
  [super layoutSubviews];
  _surfaceView.frame = self.bounds;
  [_surface setSize:self.bounds.size];
}

- (void)setAppName:(NSString *)appName
{
  NSString *nextAppName = appName.length > 0 ? appName : ThreadedRuntimeSurfaceDefaultHostAppName;
  if ([_appName isEqualToString:nextAppName]) {
    return;
  }
  _appName = [nextAppName copy];
  [self restartSurfaceIfAttached];
}

- (void)setBlockStatus:(NSString *)blockStatus
{
  NSString *nextBlockStatus = blockStatus.length > 0 ? blockStatus : @"idle";
  if ([_blockStatus isEqualToString:nextBlockStatus]) {
    return;
  }
  _blockStatus = [nextBlockStatus copy];
  if (_surface != nil) {
    NSLog(@"[ThreadedRuntime] surface ignoreBlockStatusUpdate blockStatus=%@ rootTag=%@", _blockStatus, _surface.rootViewTag);
    RCTLogInfo(@"[ThreadedRuntime] surface ignoreBlockStatusUpdate blockStatus=%@ rootTag=%@", _blockStatus, _surface.rootViewTag);
  }
}

- (void)setComponentName:(NSString *)componentName
{
  NSString *nextComponentName = componentName ?: @"";
  if ([_componentName isEqualToString:nextComponentName]) {
    return;
  }
  _componentName = [nextComponentName copy];
  [self restartSurfaceIfAttached];
}

- (void)setInitialPropsJson:(NSString *)initialPropsJson
{
  NSString *nextInitialPropsJson = initialPropsJson.length > 0 ? initialPropsJson : @"{}";
  if ([_initialPropsJson isEqualToString:nextInitialPropsJson]) {
    return;
  }
  _initialPropsJson = [nextInitialPropsJson copy];
  [self restartSurfaceIfAttached];
}

- (void)setMode:(NSString *)mode
{
  NSString *nextMode = mode ?: @"";
  if ([_mode isEqualToString:nextMode]) {
    return;
  }
  _mode = [nextMode copy];
  [self restartSurfaceIfAttached];
}

- (void)setRuntimeName:(NSString *)runtimeName
{
  NSString *nextRuntimeName = runtimeName.length > 0 ? runtimeName : ThreadedRuntimeSurfaceDefaultRuntimeName;
  if ([_runtimeName isEqualToString:nextRuntimeName]) {
    return;
  }
  _runtimeName = [nextRuntimeName copy];
  [self restartSurfaceIfAttached];
}

- (void)setSurfaceKey:(NSString *)surfaceKey
{
  NSString *nextSurfaceKey = surfaceKey ?: @"";
  if ([_surfaceKey isEqualToString:nextSurfaceKey]) {
    return;
  }
  _surfaceKey = [nextSurfaceKey copy];
  [self restartSurfaceIfAttached];
}

- (void)restartSurfaceIfAttached
{
  if (self.window == nil) {
    return;
  }
  [self stopSurface];
  [self ensureSurface];
}

- (void)ensureSurface
{
  if (_surface != nil) {
    return;
  }

  if (![ThreadedRuntime isRuntimeReadyForSurfaces:_runtimeName]) {
    [self startObservingRuntimeReady];
    [ThreadedRuntime ensureRuntimeStarted:_runtimeName];
    return;
  }

  NSDictionary *properties = @{
    @"blockStatus" : _blockStatus ?: @"idle",
    @"componentName" : _componentName ?: @"",
    @"initialPropsJson" : _initialPropsJson ?: @"{}",
    @"mode" : _mode ?: @"",
    @"runtimeName" : _runtimeName ?: ThreadedRuntimeSurfaceDefaultRuntimeName,
    @"surfaceKey" : _surfaceKey ?: @"",
  };

  _surface = [ThreadedRuntime createSurfaceWithRuntimeName:_runtimeName appName:_appName properties:properties];
  _surfaceView = [[RCTSurfaceHostingView alloc] initWithSurface:_surface
                                                sizeMeasureMode:RCTSurfaceSizeMeasureModeWidthExact |
                                                                RCTSurfaceSizeMeasureModeHeightExact];
  _surfaceView.backgroundColor = UIColor.clearColor;
  _surfaceView.frame = self.bounds;
  [self addSubview:_surfaceView];
  [_surface setSize:self.bounds.size];

  NSLog(
      @"[ThreadedRuntime] surface start runtimeName=%@ appName=%@ componentName=%@ surfaceKey=%@ rootTag=%@",
      _runtimeName,
      _appName,
      _componentName,
      _surfaceKey,
      _surface.rootViewTag);
  RCTLogInfo(
      @"[ThreadedRuntime] surface start runtimeName=%@ appName=%@ componentName=%@ surfaceKey=%@ rootTag=%@",
      _runtimeName,
      _appName,
      _componentName,
      _surfaceKey,
      _surface.rootViewTag);
}

- (void)stopSurface
{
  if (_surface == nil) {
    return;
  }

  NSLog(
      @"[ThreadedRuntime] surface stop runtimeName=%@ appName=%@ componentName=%@ surfaceKey=%@ rootTag=%@",
      _runtimeName,
      _appName,
      _componentName,
      _surfaceKey,
      _surface.rootViewTag);
  RCTLogInfo(
      @"[ThreadedRuntime] surface stop runtimeName=%@ appName=%@ componentName=%@ surfaceKey=%@ rootTag=%@",
      _runtimeName,
      _appName,
      _componentName,
      _surfaceKey,
      _surface.rootViewTag);

  [_surface stop];
  [_surfaceView removeFromSuperview];
  _surfaceView = nil;
  _surface = nil;
}

@end
