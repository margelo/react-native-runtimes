cmake_minimum_required(VERSION 3.13)
set(CMAKE_VERBOSE_MAKEFILE ON)

project(NativeComposeThreadedZustand)

# Local sources: classic JNI bindings and the shared C++ store + Hybrid implementation.
add_library(
  NativeComposeThreadedZustand
  SHARED
  src/main/jni/OnLoad.cpp
  src/main/jni/SharedZustandStoreJni.cpp
  ../cpp/SharedZustandStore.cpp
  ../cpp/HybridSharedZustandStore.cpp
)

# Make our cpp/ headers and JNI dir visible.
target_include_directories(
  NativeComposeThreadedZustand
  PUBLIC
  src/main/jni
  ../cpp
)

target_compile_options(
  NativeComposeThreadedZustand
  PRIVATE
  -fexceptions
  -frtti
  -std=c++20
  -Wall
)

# Android 15+ devices can use 16 KB memory pages; unaligned LOAD segments put
# the app behind an "App Compatibility" dialog on Android 16.
target_link_options(
  NativeComposeThreadedZustand
  PRIVATE
  -Wl,-z,max-page-size=16384
)

# Pull in nitrogen-generated sources, include dirs, and link libs (defines target_sources/include_directories/target_link_libraries on NativeComposeThreadedZustand).
include(${CMAKE_SOURCE_DIR}/../nitrogen/generated/android/NativeComposeThreadedZustand+autolinking.cmake)
