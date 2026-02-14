
/**
 * Data Service Layer
 * 
 * Provides a unified interface for data persistence.
 * Currently backed by LocalStorage, but designed to be easily swapped 
 * for a remote API or database (Supabase/Firebase/MySQL) in the future.
 */

class DataService {
  get<T>(key: string, defaultValue: T): T {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : defaultValue;
    } catch (error) {
      console.error(`DataService Error: Failed to load ${key}`, error);
      return defaultValue;
    }
  }

  set<T>(key: string, value: T): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.error(`DataService Error: Failed to save ${key}`, error);
    }
  }

  remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.error(`DataService Error: Failed to remove ${key}`, error);
    }
  }
}

export const dataService = new DataService();
