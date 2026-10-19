/**
 * Database Module - Supabase Adapter
 *
 * This module provides backward compatibility with the existing sql.js API
 * by wrapping @supabase/supabase-js with a similar interface.
 *
 * @deprecated Use src/lib/supabase.js directly for new code
 */

const supabase = require('./lib/supabase');

/**
 * For backward compatibility, db.prepare() returns an async query builder
 * that mimics sql.js prepared statements
 */
const db = {
  prepare(sql) {
    return new QueryBuilder(sql);
  },
  get client() {
    return supabase.supabase;
  },
  get admin() {
    return supabase.supabaseAdmin;
  },
};

class QueryBuilder {
  constructor(sql) {
    this.sql = sql;
    this._params = [];
  }

  bind(...params) {
    this._params = params;
    return this;
  }

  async get(...params) {
    const args = params.length ? params : this._params;
    return this._execute(args, 'single');
  }

  async all(...params) {
    const args = params.length ? params : this._params;
    return this._execute(args, 'array');
  }

  run(...params) {
    // Fire and forget for INSERT/UPDATE/DELETE
    const args = params.length ? params : this._params;
    this._execute(args, 'mutation');
    return { changes: 1 };
  }

  async _execute(params, mode = 'array') {
    const sql = this.sql.trim();
    const isSelect = sql.toUpperCase().startsWith('SELECT');
    const isInsert = sql.toUpperCase().startsWith('INSERT');
    const isUpdate = sql.toUpperCase().startsWith('UPDATE');
    const isDelete = sql.toUpperCase().startsWith('DELETE');

    // Handle PRAGMA queries (not supported in Supabase)
    if (sql.toUpperCase().includes('PRAGMA')) {
      if (mode === 'single') return undefined;
      return [];
    }

    // For SELECT queries
    if (isSelect) {
      return this._handleSelect(sql, params, mode);
    }

    // For mutation queries (INSERT/UPDATE/DELETE)
    return this._handleMutation(sql, params, mode);
  }

  _convertPlaceholders(sql) {
    let paramIndex = 1;
    return sql.replace(/\?/g, () => `$${paramIndex++}`);
  }

  async _handleSelect(sql, params, mode) {
    // Extract table name and basic structure
    const tableMatch = sql.match(/(?:FROM|JOIN)\s+(\w+)/i);
    const table = tableMatch ? tableMatch[1] : null;

    if (!table) {
      console.warn('[db] Could not extract table from:', sql.substring(0, 50));
      return mode === 'single' ? undefined : [];
    }

    // Build Supabase query
    const client = supabase.supabaseAdmin || supabase.supabase;

    // Parse basic SELECT * with simple WHERE
    const selectMatch = sql.match(/SELECT\s+(.+?)\s+FROM/i);
    const columns = selectMatch ? selectMatch[1].trim() : '*';

    // Simple case: SELECT * FROM table WHERE column = ?
    const whereMatch = sql.match(/WHERE\s+(\w+)\s*=\s*\?/i);
    const orderMatch = sql.match(/ORDER BY\s+(\w+)(?:\s+(ASC|DESC))?/i);
    const limitMatch = sql.match(/LIMIT\s+(\d+)/i);

    let query = client.from(table).select(columns);

    if (whereMatch) {
      query = query.eq(whereMatch[1], params[0]);
    }

    if (orderMatch) {
      const col = orderMatch[1];
      const desc = orderMatch[2]?.toUpperCase() === 'DESC';
      query = query.order(col, { ascending: !desc });
    }

    if (limitMatch) {
      query = query.limit(parseInt(limitMatch[1]));
    }

    // Handle JOINs for complex queries
    if (sql.toUpperCase().includes('JOIN')) {
      // For now, return empty - complex joins need manual handling
      console.warn('[db] JOIN queries need manual handling');
      return mode === 'single' ? undefined : [];
    }

    const { data, error } = await query;

    if (error) {
      console.error('[db] Query error:', error);
      throw error;
    }

    if (mode === 'single') {
      return data?.[0] || undefined;
    }
    return data || [];
  }

  async _handleMutation(sql, params, mode) {
    const tableMatch = sql.match(/(?:INTO|UPDATE|DELETE FROM)\s+(\w+)/i);
    const table = tableMatch ? tableMatch[1] : null;

    if (!table) {
      throw new Error('Could not extract table from mutation query');
    }

    const client = supabase.supabaseAdmin || supabase.supabase;
    const pgSql = this._convertPlaceholders(sql);

    if (sql.toUpperCase().startsWith('INSERT')) {
      const insertMatch = pgSql.match(/INSERT\s+INTO\s+\w+\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i);
      if (!insertMatch) {
        await client.from(table).insert({});
        return mode === 'single' ? {} : [];
      }

      const columns = insertMatch[1].split(',').map(c => c.trim());
      const data = {};
      columns.forEach((col, i) => {
        if (params[i] !== undefined) {
          data[col] = params[i];
        }
      });

      const { data: result, error } = await client.from(table).insert(data).select();
      if (error) throw error;
      return mode === 'single' ? (result?.[0] || {}) : (result || []);
    }

    if (sql.toUpperCase().startsWith('UPDATE')) {
      const setMatch = pgSql.match(/SET\s+(.+?)\s+WHERE/i);
      const whereMatch = pgSql.match(/WHERE\s+(.+?)(?:\s+$)/i);

      if (!setMatch || !whereMatch) {
        throw new Error('UPDATE requires SET and WHERE');
      }

      const setCols = setMatch[1].split(',').map(s => s.trim());
      const data = {};
      let paramIdx = 0;

      for (const col of setCols) {
        const colMatch = col.match(/(\w+)\s*=/);
        if (colMatch) {
          data[colMatch[1]] = params[paramIdx++];
        }
      }

      const whereParts = whereMatch[1].split(/\s+AND\s+/i);
      let query = client.from(table).update(data);

      for (const part of whereParts) {
        const eqMatch = part.match(/(\w+)\s*=\s*\$(\d+)/);
        if (eqMatch) {
          query = query.eq(eqMatch[1], params[parseInt(eqMatch[2]) - 1]);
        }
      }

      const { error } = await query;
      if (error) throw error;
      return { changes: 1 };
    }

    if (sql.toUpperCase().startsWith('DELETE')) {
      const whereMatch = pgSql.match(/WHERE\s+(.+?)(?:\s+$)/i);
      if (!whereMatch) {
        throw new Error('DELETE requires WHERE');
      }

      const whereParts = whereMatch[1].split(/\s+AND\s+/i);
      let query = client.from(table).delete();

      for (const part of whereParts) {
        const eqMatch = part.match(/(\w+)\s*=\s*\$(\d+)/);
        if (eqMatch) {
          query = query.eq(eqMatch[1], params[parseInt(eqMatch[2]) - 1]);
        }
      }

      const { error } = await query;
      if (error) throw error;
      return { changes: 1 };
    }

    return mode === 'single' ? {} : [];
  }
}

/**
 * Initialize database (no-op for Supabase)
 */
async function loadDb() {
  console.log('[db] Supabase adapter loaded - using @supabase/supabase-js');
  return db;
}

module.exports = {
  loadDb,
  db,
};
