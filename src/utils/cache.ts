export const getLocalCache = async <T>(key: string): Promise<T | null> => {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') return resolve(null);
    
    const request = indexedDB.open('FundGuruDB', 1);
    
    request.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains('cache')) {
        db.createObjectStore('cache');
      }
    };
    
    request.onsuccess = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains('cache')) return resolve(null);
      
      const transaction = db.transaction('cache', 'readonly');
      const store = transaction.objectStore('cache');
      const getReq = store.get(key);
      
      getReq.onsuccess = () => resolve(getReq.result || null);
      getReq.onerror = () => resolve(null);
    };
    
    request.onerror = () => resolve(null);
  });
};

export const setLocalCache = async (key: string, data: any): Promise<void> => {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') return resolve();
    
    const request = indexedDB.open('FundGuruDB', 1);
    
    request.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains('cache')) {
        db.createObjectStore('cache');
      }
    };
    
    request.onsuccess = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      const transaction = db.transaction('cache', 'readwrite');
      const store = transaction.objectStore('cache');
      store.put(data, key);
      
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
    };
    
    request.onerror = () => resolve();
  });
};

export const clearLocalCache = async (key?: string): Promise<void> => {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') return resolve();
    
    const request = indexedDB.open('FundGuruDB', 1);
    
    request.onsuccess = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains('cache')) return resolve();
      
      const transaction = db.transaction('cache', 'readwrite');
      const store = transaction.objectStore('cache');
      
      if (key) {
        store.delete(key);
      } else {
        store.clear();
      }
      
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
    };
    
    request.onerror = () => resolve();
  });
};
