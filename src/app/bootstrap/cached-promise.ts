/** Stores a pending load under `key`; a rejection is dropped from the map so a transient failure can be retried. */
export function cacheEvictingRejection<K, V>(map: Map<K, Promise<V>>, key: K, pending: Promise<V>): Promise<V> {
  const cached: Promise<V> = pending.catch((error: unknown) => {
    if (map.get(key) === cached) map.delete(key);
    throw error;
  });
  map.set(key, cached);
  return cached;
}
