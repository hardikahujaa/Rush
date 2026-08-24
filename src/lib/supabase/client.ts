"use client";

import { createBrowserClient } from "@supabase/ssr";

import {
  supabaseAnonKey,
  supabaseCookieOptions,
  supabaseUrl,
} from "./env";

/**
 * Supabase client for CLIENT components - code that runs in the browser.
 *
 * Named `createSupabaseBrowserClient`, not `createClient`, on purpose. Most
 * examples online call both this and its server counterpart `createClient`,
 * which means one wrong import gives you a client that silently reports "no
 * session" for every user instead of failing. Two distinct names make that
 * mistake impossible to write by accident.
 *
 * Only ever sees the anon key, which is public by design. What stops a visitor
 * reading someone else's orders is not secrecy of this key - it is row level
 * security plus our own server-side checks.
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient(supabaseUrl, supabaseAnonKey, {
    cookieOptions: supabaseCookieOptions,
  });
}
