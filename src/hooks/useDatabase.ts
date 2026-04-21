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
        locateFile: (file: string) => `https://sql.js.org/dist/${file}`
      });

      // Fetch the database file
      const buffer = await fetch('/parkrun.db').then(res => res.arrayBuffer());
      dbInstance = new SQL.Database(new Uint8Array(buffer));
      
      setDb(dbInstance);
      setLoading(false);
    }

    loadDatabase();
  }, []);

  return { db, loading };
}