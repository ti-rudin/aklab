/**
 * Typing helper for Strapi global instance.
 * Use: `const s = strapi as unknown as StrapiInstance;`
 */
export interface StrapiInstance {
  log: {
    info: (...args: any[]) => void;
    warn: (...args: any[]) => void;
    error: (...args: any[]) => void;
  };
  entityService: {
    findMany: (uid: string, params?: any) => Promise<any[]>;
    findOne: (uid: string, id: string | number, params?: any) => Promise<any>;
    create: (uid: string, params?: any) => Promise<any>;
    update: (uid: string, id: string | number, params?: any) => Promise<any>;
    delete: (uid: string, id: string | number, params?: any) => Promise<any>;
  };
  db: {
    query: (uid: string) => {
      findMany: (params?: any) => Promise<any[]>;
      findOne: (params?: any) => Promise<any>;
      create: (params?: any) => Promise<any>;
      update: (params?: any) => Promise<any>;
      delete: (params?: any) => Promise<any>;
      deleteMany: (params?: any) => Promise<{ count: number }>;
    };
    transaction: (cb: (params: { trx: any; rollback: () => void; commit: () => void; onCommit: (cb: () => void) => void; onRollback: (cb: () => void) => void }) => Promise<void>) => Promise<void>;
    connection: {
      raw: (sql: string, bindings?: any[]) => Promise<any>;
    };
  };
}
