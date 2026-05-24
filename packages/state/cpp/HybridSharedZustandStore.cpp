//
//  HybridSharedZustandStore.cpp
//  Pods
//
//  Created by Ritesh Shukla on 24/05/26.
//


#include "HybridSharedZustandStore.hpp"

#include "SharedZustandStore.hpp"

namespace margelo::nitro::threadedzustand {

std::optional<std::string> HybridSharedZustandStore::getState(
    const std::string& storeName,
    const std::string& subtreeKey) {
  const auto snapshot =
      SharedZustandStore::instance().getState(storeName, subtreeKey);
  if (!snapshot.has_value()) {
    return std::nullopt;
  }
  return snapshot->stateJson;
}

std::string HybridSharedZustandStore::getOrInitState(
    const std::string& storeName,
    const std::string& subtreeKey,
    const std::string& initialJson,
    const std::string& persistKey) {
  const auto snapshot = SharedZustandStore::instance().getOrInitState(
      storeName,
      subtreeKey,
      initialJson,
      persistKey.empty() ? std::nullopt
                         : std::optional<std::string>(persistKey));
  return snapshot.stateJson;
}

double HybridSharedZustandStore::setState(
    const std::string& storeName,
    const std::string& subtreeKey,
    const std::string& stateJson) {
  return SharedZustandStore::instance()
      .setState(storeName, subtreeKey, stateJson)
      .revision;
}

double HybridSharedZustandStore::getRevision(
    const std::string& storeName,
    const std::string& subtreeKey) {
  return SharedZustandStore::instance().getRevision(storeName, subtreeKey);
}

double HybridSharedZustandStore::clear(
    const std::string& storeName,
    const std::string& subtreeKey) {
  return SharedZustandStore::instance().clear(storeName, subtreeKey);
}

void HybridSharedZustandStore::setPersistedState(
    const std::string& persistKey,
    const std::string& stateJson) {
  SharedZustandStore::instance().setPersistedState(persistKey, stateJson);
}

void HybridSharedZustandStore::clearPersistedState(
    const std::string& persistKey) {
  SharedZustandStore::instance().clearPersistedState(persistKey);
}

} // namespace margelo::nitro::threadedzustand
