//
//  HybridSharedZustandStore.hpp
//  Pods
//
//  Created by Ritesh Shukla on 24/05/26.
//



#pragma once

#include "HybridSharedZustandStoreSpec.hpp"

namespace margelo::nitro::threadedzustand {

class HybridSharedZustandStore final : public HybridSharedZustandStoreSpec {
 public:
  HybridSharedZustandStore() : HybridObject(TAG) {}

  std::optional<std::string> getState(
      const std::string& storeName,
      const std::string& subtreeKey) override;
  std::string getOrInitState(
      const std::string& storeName,
      const std::string& subtreeKey,
      const std::string& initialJson,
      const std::string& persistKey) override;
  double setState(
      const std::string& storeName,
      const std::string& subtreeKey,
      const std::string& stateJson) override;
  double getRevision(
      const std::string& storeName,
      const std::string& subtreeKey) override;
  double clear(const std::string& storeName, const std::string& subtreeKey)
      override;
  void setPersistedState(
      const std::string& persistKey,
      const std::string& stateJson) override;
  void clearPersistedState(const std::string& persistKey) override;
};

} // namespace margelo::nitro::threadedzustand
