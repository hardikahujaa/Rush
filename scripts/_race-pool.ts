/**
 * Sizes the connection pool for the concurrency test.
 *
 * MUST be imported before `../src/db`. ES modules evaluate depth-first in the
 * order their import statements appear, and this file has no dependencies of its
 * own, so it finishes running before the db module is even constructed - which
 * is the only moment `DB_POOL_MAX` is read.
 *
 * Doing it here rather than as a shell prefix is a Windows concern: npm runs
 * scripts through cmd, where `DB_POOL_MAX=50 tsx ...` is a syntax error rather
 * than an environment assignment.
 *
 * `??=` so an explicitly set value still wins, which is what makes it possible
 * to re-run the test at a different pool size without editing anything.
 */
process.env.DB_POOL_MAX ??= "50";

export {};
