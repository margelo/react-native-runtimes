#pragma once

#include <memory>
#include <mutex>
#include <shared_mutex>
#include <optional>
#include <string>
#include <unordered_map>

namespace margelo::nitro::threadedzustand {

class SharedZustandStore {
 public:
  struct Entry {
    mutable std::shared_mutex mutex;
    std::string stateJson;
    int revision = 0;
    bool hasState = false;
  };

  struct Snapshot {
    std::string stateJson;
    int revision = 0;
  };

  static SharedZustandStore& instance();

  Snapshot setState(
      const std::string& storeName,
      const std::string& subtreeKey,
      std::string stateJson);
  Snapshot getOrInitState(
      const std::string& storeName,
      const std::string& subtreeKey,
      std::string initialJson,
      const std::optional<std::string>& persistKey = std::nullopt);
  std::optional<Snapshot> getState(
      const std::string& storeName,
      const std::string& subtreeKey);
  int getRevision(const std::string& storeName, const std::string& subtreeKey);
  int clear(const std::string& storeName, const std::string& subtreeKey);
  void setPersistenceDirectory(std::string directory);
  void setPersistedState(
      const std::string& persistKey,
      const std::string& stateJson);
  void clearPersistedState(const std::string& persistKey);

 private:
  static std::string makeKey(
      const std::string& storeName,
      const std::string& subtreeKey);

  std::shared_ptr<Entry> getOrCreateEntry(
      const std::string& storeName,
      const std::string& subtreeKey);
  std::shared_ptr<Entry> findEntry(
      const std::string& storeName,
      const std::string& subtreeKey);
  std::optional<std::string> getPersistedState(const std::string& persistKey);
  std::string persistencePathForKey(const std::string& persistKey);

  std::mutex registryMutex_;
  std::mutex persistenceMutex_;
  std::string persistenceDirectory_;
  std::unordered_map<std::string, std::shared_ptr<Entry>> stores_;
};

} // namespace margelo::nitro::threadedzustand
