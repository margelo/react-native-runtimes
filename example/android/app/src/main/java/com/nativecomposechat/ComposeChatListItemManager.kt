package com.nativecomposechat

import android.view.View
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ViewGroupManager
import com.facebook.react.uimanager.ViewManagerDelegate
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.viewmanagers.ComposeChatListItemManagerDelegate
import com.facebook.react.viewmanagers.ComposeChatListItemManagerInterface

class ComposeChatListItemManager :
    ViewGroupManager<ComposeChatListItemView>(),
    ComposeChatListItemManagerInterface<ComposeChatListItemView> {
  private val delegate: ViewManagerDelegate<ComposeChatListItemView> =
      ComposeChatListItemManagerDelegate(this)

  override fun getDelegate(): ViewManagerDelegate<ComposeChatListItemView> = delegate

  override fun getName(): String = "ComposeChatListItem"

  override fun createViewInstance(reactContext: ThemedReactContext): ComposeChatListItemView =
      ComposeChatListItemView(reactContext)

  @ReactProp(name = "itemIndex", defaultInt = -1)
  override fun setItemIndex(view: ComposeChatListItemView, value: Int) {
    view.setItemIndex(value)
  }

  @ReactProp(name = "itemId")
  override fun setItemId(view: ComposeChatListItemView, value: String?) {
    view.setItemId(value ?: "")
  }

  @ReactProp(name = "renderVersion", defaultInt = 0)
  override fun setRenderVersion(view: ComposeChatListItemView, value: Int) {
    view.setRenderVersion(value)
  }

  @ReactProp(name = "contentType")
  override fun setContentType(view: ComposeChatListItemView, value: String?) {
    view.setContentType(value ?: "default")
  }

  @ReactProp(name = "hostSlot")
  override fun setHostSlot(view: ComposeChatListItemView, value: String?) {
    view.setHostSlot(value ?: "")
  }

  @ReactProp(name = "messagePreview")
  override fun setMessagePreview(view: ComposeChatListItemView, value: String?) {
    view.setMessagePreview(value ?: "")
  }

  @ReactProp(name = "measuredHeight", defaultInt = 0)
  override fun setMeasuredHeight(view: ComposeChatListItemView, value: Int) {
    view.setMeasuredContentHeightDp(value)
  }

  override fun addView(parent: ComposeChatListItemView, child: View, index: Int) {
    parent.addFabricChild(child, index)
  }

  @Suppress("PARAMETER_NAME_CHANGED_ON_OVERRIDE")
  override fun removeView(view: ComposeChatListItemView, child: View) {
    view.removeFabricChild(child)
  }

  override fun getChildAt(parent: ComposeChatListItemView, index: Int): View? =
      parent.getChildAt(index)

  override fun getChildCount(parent: ComposeChatListItemView): Int = parent.childCount
}
