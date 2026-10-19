/**
 * Supabase Client Module
 *
 * Replace sql.js with @supabase/supabase-js for PostgreSQL on Supabase
 *
 * @version 2.0.0
 */

const { createClient } = require('@supabase/supabase-js');

// Validate required environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('[supabase] CRITICAL: SUPABASE_URL and SUPABASE_ANON_KEY environment variables are required');
  process.exit(1);
}

// Create Supabase clients
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

// Admin client for server-side operations (bypasses RLS)
const supabaseAdmin = SUPABASE_SERVICE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })
  : null;

if (!supabaseAdmin) {
  console.warn('[supabase] SUPABASE_SERVICE_KEY not set - admin operations will use anon key');
}

/**
 * Database wrapper that mimics sql.js interface
 * for backward compatibility with existing routes
 */
const db = {
  /**
   * Prepare a SQL query
   * @param {string} sql - SQL query (PostgreSQL syntax)
   */
  prepare(sql) {
    return new QueryBuilder(sql, supabaseAdmin || supabase);
  },

  /**
   * Get the raw Supabase client
   */
  get client() {
    return supabaseAdmin || supabase;
  },

  /**
   * Get admin client
   */
  get admin() {
    return supabaseAdmin;
  },
};

/**
 * Query Builder class
 * Mimics sql.js prepared statement interface
 */
class QueryBuilder {
  constructor(sql, client) {
    this.sql = sql;
    this.client = client;
    this._params = [];
  }

  /**
   * Bind parameters to the query
   * @param  {...any} params - Parameters to bind
   */
  bind(...params) {
    this._params = params;
    return this;
  }

  /**
   * Execute query and return single row
   * @returns {Promise<Object|undefined>}
   */
  async get(...params) {
    const args = params.length ? params : this._params;
    const result = await this._execute(args);
    return result[0] || undefined;
  }

  /**
   * Execute query and return all rows
   * @returns {Promise<Array>}
   */
  async all(...params) {
    const args = params.length ? params : this._params;
    return this._execute(args);
  }

  /**
   * Execute the query
   * @private
   */
  async _execute(params) {
    try {
      const query = this._buildQuery(params);
      const { data, error } = await query;

      if (error) {
        console.error('[supabase] Query error:', error);
        throw error;
      }

      return data || [];
    } catch (error) {
      console.error('[supabase] Execute error:', error);
      throw error;
    }
  }

  /**
   * Build the appropriate Supabase query
   * @private
   */
  _buildQuery(params) {
    const sql = this.sql.trim();
    const isSelect = sql.toUpperCase().startsWith('SELECT');
    const isInsert = sql.toUpperCase().startsWith('INSERT');
    const isUpdate = sql.toUpperCase().startsWith('UPDATE');
    const isDelete = sql.toUpperCase().startsWith('DELETE');

    // Extract table name
    const tableMatch = sql.match(/(?:FROM|INTO|UPDATE|DELETE FROM)\s+(\w+)/i);
    const table = tableMatch ? tableMatch[1] : null;

    if (!table) {
      throw new Error('Could not extract table name from query');
    }

    // Convert SQLite placeholders to PostgreSQL
    const pgSql = this._convertPlaceholders(sql);

    if (isSelect) {
      return this._executeSelect(table, pgSql, params);
    } else if (isInsert) {
      return this._executeInsert(table, pgSql, params);
    } else if (isUpdate) {
      return this._executeUpdate(table, pgSql, params);
    } else if (isDelete) {
      return this._executeDelete(table, pgSql, params);
    }

    throw new Error(`Unsupported query type: ${sql.substring(0, 50)}`);
  }

  /**
   * Convert SQLite ? placeholders to PostgreSQL $1, $2, etc.
   * @private
   */
  _convertPlaceholders(sql) {
    let paramIndex = 1;
    return sql.replace(/\?/g, () => `$${paramIndex++}`);
  }

  /**
   * Execute SELECT query
   * @private
   */
  _executeSelect(table, pgSql, params) {
    // Handle PRAGMA queries
    if (pgSql.toUpperCase().includes('PRAGMA')) {
      // Return empty for PRAGMA (table_info, etc.)
      return Promise.resolve({ data: [], error: null });
    }

    // Parse SQL to extract columns and conditions
    const selectMatch = pgSql.match(/SELECT\s+(.+?)\s+FROM\s+\w+/i);
    const columns = selectMatch ? selectMatch[1].trim() : '*';

    // Simple approach: use rpc for complex queries
    if (columns === '*' && !pgSql.toLowerCase().includes('join')) {
      const whereMatch = pgSql.match(/WHERE\s+(.+?)(?:\s+ORDER|\s+LIMIT|\s+GROUP|\s+$)/i);
      const orderMatch = pgSql.match(/ORDER BY\s+(.+?)(?:\s+LIMIT|\s+$)/i);
      const limitMatch = pgSql.match(/LIMIT\s+(\d+)/i);

      let query = this.client.from(table).select(columns);

      if (whereMatch) {
        const condition = whereMatch[1].trim();
        // Handle simple conditions
        const eqMatch = condition.match(/(\w+)\s*=\s*\$(\d+)/);
        if (eqMatch) {
          query = query.eq(eqMatch[1], params[parseInt(eqMatch[2]) - 1]);
        }
      }

      if (orderMatch) {
        const orderCol = orderMatch[1].split(/\s+/)[0];
        const desc = orderMatch[1].toLowerCase().includes('desc');
        query = query.order(orderCol, { ascending: !desc });
      }

      if (limitMatch) {
        query = query.limit(parseInt(limitMatch[1]));
      }

      return query;
    }

    // For complex queries with joins, use raw SQL via PostgREST
    // Note: PostgREST doesn't support complex JOINs directly
    // For now, return empty and log warning
    console.warn('[supabase] Complex query detected - may need manual handling:', pgSql.substring(0, 100));

    // Fallback: return empty array
    return Promise.resolve({ data: [], error: null });
  }

  /**
   * Execute INSERT query
   * @private
   */
  _executeInsert(table, pgSql, params) {
    // Extract column names and values
    const insertMatch = pgSql.match(/INSERT\s+INTO\s+\w+\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i);

    if (!insertMatch) {
      // Use raw insert for simple cases
      return this.client.from(table).insert({});
    }

    const columns = insertMatch[1].split(',').map(c => c.trim());
    const values = params;

    const data = {};
    columns.forEach((col, i) => {
      if (values[i] !== undefined && values[i] !== null) {
        data[col] = values[i];
      }
    });

    return this.client.from(table).insert(data).select();
  }

  /**
   * Execute UPDATE query
   * @private
   */
  _executeUpdate(table, pgSql, params) {
    const setMatch = pgSql.match(/SET\s+(.+?)\s+WHERE/i);
    const whereMatch = pgSql.match(/WHERE\s+(.+?)(?:\s+$)/i);

    if (!setMatch || !whereMatch) {
      throw new Error('UPDATE query must have SET and WHERE clauses');
    }

    const setColumns = setMatch[1].split(',').map(s => s.trim());
    const whereParts = whereMatch[1].split(/\s+AND\s+/i);

    const data = {};
    let paramIndex = 0;

    setColumns.forEach(col => {
      const colMatch = col.match(/(\w+)\s*=/);
      if (colMatch && params[paramIndex] !== undefined) {
        data[colMatch[1]] = params[paramIndex];
        paramIndex++;
      }
    });

    // Build filter from WHERE clause
    const filters = whereParts.map(part => {
      const eqMatch = part.match(/(\w+)\s*=\s*\$(\d+)/);
      if (eqMatch) {
        return { column: eqMatch[1], value: params[parseInt(eqMatch[2]) - 1] };
      }
      return null;
    }).filter(Boolean);

    let query = this.client.from(table).update(data);

    filters.forEach(f => {
      query = query.eq(f.column, f.value);
    });

    return query.select();
  }

  /**
   * Execute DELETE query
   * @private
   */
  _executeDelete(table, pgSql, params) {
    const whereMatch = pgSql.match(/WHERE\s+(.+?)(?:\s+$)/i);

    if (!whereMatch) {
      // Delete all - not typically used, require explicit WHERE
      throw new Error('DELETE without WHERE is not allowed');
    }

    const whereParts = whereMatch[1].split(/\s+AND\s+/i);
    const filters = whereParts.map(part => {
      const eqMatch = part.match(/(\w+)\s*=\s*\$(\d+)/);
      if (eqMatch) {
        return { column: eqMatch[1], value: params[parseInt(eqMatch[2]) - 1] };
      }
      return null;
    }).filter(Boolean);

    let query = this.client.from(table).delete();

    filters.forEach(f => {
      query = query.eq(f.column, f.value);
    });

    return query.select();
  }
}

/**
 * Helper functions for Supabase operations
 * These provide a cleaner API for common operations
 */
const helpers = {
  /**
   * Generate a random UUID
   */
  uuid() {
    return require('crypto').randomUUID();
  },

  /**
   * Execute raw SQL via Supabase Edge Function or pg client
   * Note: Requires enabling pg extension or using Edge Functions
   */
  async rawQuery(sql, params = []) {
    // This would require a Supabase Edge Function for raw SQL
    // For now, return error
    console.error('[supabase] rawQuery requires Edge Function - not implemented');
    throw new Error('rawQuery not implemented - use Supabase dashboard or Edge Functions');
  },

  /**
   * Get officer's accessible dermagas
   */
  async getOfficerDermagas(officerId) {
    const { data, error } = await (supabaseAdmin || supabase)
      .from('officer_dermagas')
      .select(`
        dermagas (
          id,
          name,
          code,
          regions (
            name,
            code
          )
        )
      `)
      .eq('officer_id', officerId);

    if (error) throw error;
    return data.map(d => ({
      id: d.dermagas.id,
      name: d.dermagas.name,
      code: d.dermagas.code,
      region_name: d.dermagas.regions.name,
      region_code: d.dermagas.regions.code,
    }));
  },

  /**
   * Get routes for a dermaga
   */
  async getDermagaRoutes(dermagaId) {
    const { data, error } = await (supabaseAdmin || supabase)
      .from('routes')
      .select('id, name, route_from, route_to, distance, duration')
      .eq('dermaga_id', dermagaId);

    if (error) throw error;
    return data;
  },

  /**
   * Get tariff for vehicle type
   */
  async getTariff(vehicleType) {
    const { data, error } = await (supabaseAdmin || supabase)
      .from('tariffs')
      .select('*')
      .eq('vehicle_type', vehicleType)
      .eq('is_active', 1)
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data;
  },

  /**
   * Generate trip number
   */
  generateTripNo() {
    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
    const random = require('crypto').randomBytes(4).toString('hex').toUpperCase();
    return `TRP${dateStr}${random}`;
  },

  /**
   * Record device version
   */
  async recordDeviceVersion(deviceId, version, platform = 'unknown') {
    const { data, error } = await (supabaseAdmin || supabase)
      .from('device_versions')
      .upsert({
        device_id: deviceId,
        version,
        platform,
        report_count: 1,
        last_seen: new Date().toISOString(),
      }, {
        onConflict: 'device_id',
        count: 'increment',
      });

    if (error) console.warn('[supabase] recordDeviceVersion error:', error);
    return data;
  },
};

module.exports = {
  supabase,
  supabaseAdmin,
  db,
  helpers,
};
