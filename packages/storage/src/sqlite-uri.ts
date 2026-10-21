/**
 * The SQLCipher binding turns on URI filenames only when SQLITE_USE_URI is "1"
 * at addon load (sqlite3_config before the library is initialized).
 * This module is imported before better-sqlite3-multiple-ciphers so a read-only
 * `file:<path>?mode=ro&immutable=1` peek does not need another SQLite library.
 */
process.env.SQLITE_USE_URI = '1'
