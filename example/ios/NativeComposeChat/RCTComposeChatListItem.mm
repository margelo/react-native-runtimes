#import "RCTComposeChatListItem.h"

#import <react/renderer/components/NativeComposeChatSpec/ComponentDescriptors.h>
#import <react/renderer/components/NativeComposeChatSpec/Props.h>
#import <react/renderer/components/NativeComposeChatSpec/RCTComponentViewHelpers.h>

using namespace facebook::react;

@interface RCTComposeChatListItem () <RCTComposeChatListItemViewProtocol>
@end

@implementation RCTComposeChatListItem

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  return concreteComponentDescriptorProvider<ComposeChatListItemComponentDescriptor>();
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    static const auto defaultProps = std::make_shared<const ComposeChatListItemProps>();
    _props = defaultProps;
  }

  return self;
}

@end
