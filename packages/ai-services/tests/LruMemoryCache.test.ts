import { describe, it, expect } from 'vitest';
import { LruMemoryCache } from '../src/cache/LruMemoryCache';

describe('LruMemoryCache', () => {
  it('stores and retrieves cached entries', () => {
    const cache = new LruMemoryCache<string, string>(3);
    cache.set('a', '1');
    cache.set('b', '2');
    expect(cache.get('a')).toBe('1');
    expect(cache.get('b')).toBe('2');
    expect(cache.get('c')).toBeUndefined();
  });

  it('evicts least recently used entry when reaching capacity', () => {
    const cache = new LruMemoryCache<string, number>(2);
    cache.set('x', 10);
    cache.set('y', 20);
    // Access 'x' to promote it
    cache.get('x');
    // Add 'z', should evict 'y'
    cache.set('z', 30);

    expect(cache.get('x')).toBe(10);
    expect(cache.get('z')).toBe(30);
    expect(cache.get('y')).toBeUndefined();
  });
});
