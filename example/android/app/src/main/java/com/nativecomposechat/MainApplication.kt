package com.nativecomposechat

import android.app.Application
import android.content.pm.ApplicationInfo
import android.os.Handler
import android.os.Looper
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.ease.EaseViewPackage
import com.nativecompose.threadedruntime.ThreadedRuntime
import com.nativecompose.threadedzustand.ThreadedZustandPackage
import com.margelo.nitro.NitroModulesPackage

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Packages that cannot be autolinked yet can be added manually here, for example:
          add(ComposeChatListPackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    ThreadedRuntime.setMainReactPackagesProvider {
      PackageList(this).packages.apply {
        add(ComposeChatListPackage())
      }
    }
    ThreadedRuntime.setExtraReactPackagesProvider {
      listOf(
          NitroModulesPackage(),
          ThreadedZustandPackage(),
          EaseViewPackage(),
      )
    }
    loadReactNative(this)
    val prewarmBackgroundRuntimes = {
      ThreadedRuntime.prewarmRuntime(
          applicationContext,
          "chat-thread-release-room-runtime",
      )
      ThreadedRuntime.prewarmBusinessRuntime(
          applicationContext,
          "two-runtimes-business-runtime",
      )
      ThreadedRuntime.dispatchHeadlessTask(
          applicationContext,
          "two-runtimes-business-runtime",
          "twoRuntimes:startBusinessRuntime",
          "{\"startedBy\":\"android native startup\",\"enqueuedAt\":${System.currentTimeMillis()}}",
      )
    }

    if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) {
      Handler(Looper.getMainLooper()).postDelayed(prewarmBackgroundRuntimes, 3000)
    } else {
      prewarmBackgroundRuntimes()
    }
  }
}
