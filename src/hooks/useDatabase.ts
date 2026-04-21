import { useState, useEffect } from 'react';
import initSqlJs, { Database } from 'sql.js';

let dbInstance: Database | null = null;

export function useDatabase() {
  const [db, setDb] = useState<Database | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadDatabase() {
      if (dbInstance) {
        setDb(dbInstance);
        setLoading(false);
        return;
      }

      // Load SQL.js WASM
      const SQL = await initSqlJs({
        locateFile: (file: string) => import.meta.env.BASE_URL + file
      });

      // Fetch the database file
      const buffer = await fetch(import.meta.env.BASE_URL + 'parkrun.db').then(res => res.arrayBuffer());
      dbInstance = new SQL.Database(new Uint8Array(buffer));
      
      setDb(dbInstance);
      setLoading(false);
    }

    loadDatabase();
  }, []);

  return { db, loading };
}