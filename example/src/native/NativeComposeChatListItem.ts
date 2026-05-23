import type {HostComponent, ViewProps} from 'react-native';
// eslint-disable-next-line @react-native/no-deep-imports
import codegenNativeComponent from 'react-native/Libraries/Utilities/codegenNativeComponent';
import type {Int32} from 'react-native/Libraries/Types/CodegenTypes';

export interface NativeProps extends ViewProps {
  itemIndex: Int32;
  itemId: string;
  renderVersion: Int32;
  contentType?: string;
  hostSlot?: string;
  messagePreview?: string;
  measuredHeight?: Int32;
}

export default codegenNativeComponent<NativeProps>(
  'ComposeChatListItem',
) as HostComponent<NativeProps>;
