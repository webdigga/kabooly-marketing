import { env, SELF } from "cloudflare:test";

/*
 * SELF and env are deprecated in favour of the cloudflare:workers module, but
 * the replacement relies on Cloudflare.GlobalProps typing that stable
 * workers-types cannot express yet. Funnelled through here so the eventual
 * migration is a two-line change.
 */
// eslint-disable-next-line @typescript-eslint/no-deprecated
const worker = SELF;
// eslint-disable-next-line @typescript-eslint/no-deprecated
export const testEnv = env;

export function appFetch(path: string, init?: RequestInit): Promise<Response> {
  return worker.fetch(`http://localhost${path}`, init);
}
