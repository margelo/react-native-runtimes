cmake_minimum_required(VERSION 3.13)
set(CMAKE_VERBOSE_MAKEFILE ON)

project(NativeComposeThreadedRuntime)

add_library(
  NativeComposeThreadedRuntime
  SHARED
  src/main/jni/OnLoad.cpp
  ../cpp/HybridThreadedRuntimeFunctions.cpp
  ../cpp/nativecompose/threadedruntime/RuntimeFunctionJsi.cpp
  ../cpp/nativecompose/threadedruntime/RuntimeFunctionScheduler.cpp
  ../cpp/nativecompose/threadedruntime/ThreadedRuntimeBindingsInstaller.cpp
)

target_include_directories(
  NativeComposeThreadedRuntime
  PUBLIC
  src/main/jni
  ../cpp
  ../cpp/nativecompose/threadedruntime
)

target_compile_options(
  NativeComposeThreadedRuntime
  PRIVATE
  -fexceptions
  -frtti
  -std=c++20
  -Wall
)

# Android 15+ devices can use 16 KB memory pages; unaligned LOAD segments put
# the app behind an "App Compatibility" dialog on Android 16.
target_link_options(
  NativeComposeThreadedRuntime
  PRIVATE
  -Wl,-z,max-page-size=16384
)

# Pull in nitrogen-generated sources, include dirs, and link libs.
include(${CMAKE_SOURCE_DIR}/../nitrogen/generated/android/NativeComposeThreadedRuntime+autolinking.cmake)
