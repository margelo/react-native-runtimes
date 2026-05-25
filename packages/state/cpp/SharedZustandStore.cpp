#include "SharedZustandStore.hpp"

#include <cctype>
#include <fstream>
#include <sstream>
#include <sys/stat.h>
#include <sys/types.h>
#include <utility>

namespace margelo::nitro::threadedzustand {

SharedZustandStore& SharedZustandStore::instance() {
  static SharedZustandStore store;
  return store;
}

std::string SharedZustandStore::makeKey(
    const std::string& storeName,
    const std::string& subtreeKey) {
  return storeName + '\x1f' + subtreeKey;
}

std::shared_ptr<SharedZustandStore::Entry> SharedZustandStore::getOrCreateEntry(
    const std::string& storeName,
    const std::string& subtreeKey) {
  std::lock_guard<std::mutex> lock(registryMutex_);
  auto key = makeKey(storeName, subtreeKey);
  auto& entry = stores_[key];
  if (!entry) {
    entry = std::make_shared<Entry>();
  }
  return entry;
}

std::shared_ptr<SharedZustandStore::Entry> SharedZustandStore::findEntry(
    const std::string& storeName,
    const std::string& subtreeKey) {
  std::lock_guard<std::mutex> lock(registryMutex_);
  auto iterator = stores_.find(makeKey(storeName, subtreeKey));
  if (iterator == stores_.end()) {
    return nullptr;
  }
  return iterator->second;
}

SharedZustandStore::Snapshot SharedZustandStore::setState(
    const std::string& storeName,
    const std::string& subtreeKey,
    std::string stateJson) {
  auto entry = getOrCreateEntry(storeName, subtreeKey);
  std::lock_guard<std::shared_mutex> lock(entry->mutex);
  entry->stateJson = std::move(stateJson);
  entry->revision += 1;
  entry->hasState = true;
  return Snapshot{entry->stateJson, entry->revision};
}

SharedZustandStore::Snapshot SharedZustandStore::getOrInitState(
    const std::string& storeName,
    const std::string& subtreeKey,
    std::string initialJson,
    const std::optional<std::string>& persistKey) {
  auto entry = getOrCreateEntry(storeName, subtreeKey);
  std::lock_guard<std::shared_mutex> lock(entry->mutex);
  if (!entry->hasState) {
    entry->stateJson =
        persistKey.has_value()
            ? getPersistedState(*persistKey).value_or(std::move(initialJson))
            : std::move(initialJson);
    entry->revision += 1;
    entry->hasState = true;
  }
  return Snapshot{entry->stateJson, entry->revision};
}

std::optional<SharedZustandStore::Snapshot> SharedZustandStore::getState(
    const std::string& storeName,
    const std::string& subtreeKey) {
  auto entry = findEntry(storeName, subtreeKey);
  if (!entry) {
    return std::nullopt;
  }
  std::shared_lock<std::shared_mutex> lock(entry->mutex);
  if (!entry->hasState) {
    return std::nullopt;
  }
  return Snapshot{entry->stateJson, entry->revision};
}

int SharedZustandStore::getRevision(
    const std::string& storeName,
    const std::string& subtreeKey) {
  auto entry = findEntry(storeName, subtreeKey);
  if (!entry) {
    return 0;
  }
  std::shared_lock<std::shared_mutex> lock(entry->mutex);
  return entry->revision;
}

int SharedZustandStore::clear(
    const std::string& storeName,
    const std::string& subtreeKey) {
  auto entry = getOrCreateEntry(storeName, subtreeKey);
  std::lock_guard<std::shared_mutex> lock(entry->mutex);
  entry->stateJson.clear();
  entry->revision += 1;
  entry->hasState = false;
  return entry->revision;
}

void SharedZustandStore::setPersistenceDirectory(std::string directory) {
  std::lock_guard<std::mutex> lock(persistenceMutex_);
  persistenceDirectory_ = std::move(directory);
  if (!persistenceDirectory_.empty()) {
    mkdir(persistenceDirectory_.c_str(), 0700);
  }
}

void SharedZustandStore::setPersistedState(
    const std::string& persistKey,
    const std::string& stateJson) {
  if (persistKey.empty()) {
    return;
  }

  std::lock_guard<std::mutex> lock(persistenceMutex_);
  const auto path = persistencePathForKey(persistKey);
  if (path.empty()) {
    return;
  }

  std::ofstream output(path, std::ios::binary | std::ios::trunc);
  output << stateJson;
}

void SharedZustandStore::clearPersistedState(const std::string& persistKey) {
  if (persistKey.empty()) {
    return;
  }

  std::lock_guard<std::mutex> lock(persistenceMutex_);
  const auto path = persistencePathForKey(persistKey);
  if (!path.empty()) {
    std::remove(path.c_str());
  }
}

std::optional<std::string> SharedZustandStore::getPersistedState(
    const std::string& persistKey) {
  if (persistKey.empty()) {
    return std::nullopt;
  }

  std::lock_guard<std::mutex> lock(persistenceMutex_);
  const auto path = persistencePathForKey(persistKey);
  if (path.empty()) {
    return std::nullopt;
  }

  std::ifstream input(path, std::ios::binary);
  if (!input.good()) {
    return std::nullopt;
  }

  std::ostringstream buffer;
  buffer << input.rdbuf();
  return buffer.str();
}

std::string SharedZustandStore::persistencePathForKey(
    const std::string& persistKey) {
  if (persistenceDirectory_.empty()) {
    return "";
  }

  std::string safeKey;
  safeKey.reserve(persistKey.size());
  for (const auto character : persistKey) {
    const auto byte = static_cast<unsigned char>(character);
    safeKey.push_back(
        std::isalnum(byte) || character == '.' || character == '_' ||
                character == '-'
            ? character
            : '_');
  }
  return persistenceDirectory_ + "/" + safeKey + ".json";
}

} // namespace margelo::nitro::threadedzustand
