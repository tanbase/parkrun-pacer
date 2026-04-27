import { useState, useEffect } from 'react';
import initSqlJs, { Database } from 'sql.js';

let dbInstance: Database | null = null;

export function useDatabase() {
  const [db, setDb] = useState<Database | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const abortController = new AbortController();

    async function loadDatabase() {
      if (dbInstance) {
        if (mounted) {
          setDb(dbInstance);
          setLoading(false);
        }
        return;
      }

      try {
        // Load SQL.js WASM
        const SQL = await initSqlJs({
          locateFile: (file: string) => `/parkrun-pacer/${file}`
        });

        // Fetch the database file
        const buffer = await fetch('/parkrun-pacer/parkrun.db', {
          signal: abortController.signal
        }).then(res => res.arrayBuffer());
        
        dbInstance = new SQL.Database(new Uint8Array(buffer));
        
        if (mounted) {
          setDb(dbInstance);
          setLoading(false);
        }
      } catch (err) {
        if (mounted && err.name !== 'AbortError') {
          console.error('Failed to load database:', err);
          setLoading(false);
        }
      }
    }

    loadDatabase();

    return () => {
      mounted = false;
      abortController.abort();
    };
  }, []);

  return { db, loading };
}
