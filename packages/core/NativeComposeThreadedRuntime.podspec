require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "NativeComposeThreadedRuntime"
  s.version      = package["version"]
  s.summary      = "Run selected React Native surfaces on a secondary runtime."
  s.homepage     = "https://github.com/react-native-runtimes/core"
  s.license      = "MIT"
  s.authors      = "Native Compose"

  s.platforms    = { :ios => min_ios_version_supported }
  s.source       = { :git => "https://github.com/react-native-runtimes/core.git", :tag => "#{s.version}" }

  s.source_files = [
    "ios/**/*.{h,m,mm,swift}",
    "cpp/**/*.{h,hpp,c,cpp,mm}",
  ]
  s.public_header_files = "ios/**/*.h"

  s.pod_target_xcconfig = {
    "CLANG_CXX_LANGUAGE_STANDARD" => "c++20",
    "DEFINES_MODULE" => "YES",
  }

  load 'nitrogen/generated/ios/NativeComposeThreadedRuntime+autolinking.rb'
  add_nitrogen_files(s)

  # NitroModules ships `HybridObject.hpp` publicly but `HybridObjectPrototype.hpp`
  # privately, even though the former #includes the latter. Add NitroModules's
  # private-headers dir to our pod's search paths so the transitive include
  # resolves when compiling the nitrogen autolinking shims.
  s.pod_target_xcconfig = (s.attributes_hash['pod_target_xcconfig'] || {}).merge({
    "HEADER_SEARCH_PATHS" => '"$(PODS_ROOT)/Headers/Private/NitroModules"',
  })

  install_modules_dependencies(s)
  s.dependency "React-RCTAppDelegate"
end
