import { getTableConfig } from "drizzle-orm/sqlite-core";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "../src/db/schema";
import { testEnv } from "./helpers";

/*
 * Deleting an account must wipe everything it owns. Every owned table
 * therefore cascades from its parent.
 */
const ownedTables = [
  schema.session,
  schema.account,
  schema.businessProfiles,
  schema.profileServices,
  schema.adverts,
  schema.advertImages,
];

const NOW = 1_760_000_000;

// Storage persists across tests in a file, so each test starts from a clean
// account (the delete cascades to everything below it).
async function seed(): Promise<void> {
  await testEnv.DB.batch([
    testEnv.DB.prepare("DELETE FROM user"),
    testEnv.DB.prepare(
      "INSERT INTO user (id, name, email, created_at, updated_at) VALUES ('u1', 'Test', 'u1@example.com', ?1, ?1)"
    ).bind(NOW),
    testEnv.DB.prepare(
      "INSERT INTO business_profiles (user_id, business_name, description, target_audience, local_area, tone, created_at, updated_at) VALUES ('u1', 'Acme Cleaning', 'Domestic cleaning', 'Busy families', 'Twickenham', 3, ?1, ?1)"
    ).bind(NOW),
    testEnv.DB.prepare(
      "INSERT INTO profile_services (id, user_id, name, position, created_at) VALUES ('s1', 'u1', 'Oven cleaning', 0, ?1)"
    ).bind(NOW),
    testEnv.DB.prepare(
      "INSERT INTO adverts (id, user_id, topic, body, created_at, updated_at) VALUES ('a1', 'u1', 'Spring clean', 'Text', ?1, ?1)"
    ).bind(NOW),
    testEnv.DB.prepare(
      "INSERT INTO advert_images (advert_id, platform, r2_key, generated_at) VALUES ('a1', 'instagram', 'adverts/a1/instagram.png', ?1)"
    ).bind(NOW),
  ]);
}

async function count(table: string): Promise<number> {
  const row = await testEnv.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{
    n: number;
  }>();
  return row?.n ?? -1;
}

describe("schema", () => {
  beforeEach(async () => {
    await seed();
  });

  it("declares a cascading foreign key on every owned table", () => {
    for (const table of ownedTables) {
      const config = getTableConfig(table);
      expect(config.foreignKeys.length).toBeGreaterThanOrEqual(1);
      for (const fk of config.foreignKeys) {
        expect(fk.onDelete).toBe("cascade");
        expect([schema.user, schema.businessProfiles, schema.adverts]).toContain(
          fk.reference().foreignTable
        );
      }
    }
  });

  it("indexes the columns every lookup filters on", () => {
    const indexed = (table: Parameters<typeof getTableConfig>[0]) =>
      getTableConfig(table).indexes.map((i) => i.config.name);
    expect(indexed(schema.session)).toContain("session_user_id_idx");
    expect(indexed(schema.account)).toContain("account_user_id_idx");
    expect(indexed(schema.verification)).toContain("verification_identifier_idx");
    expect(indexed(schema.profileServices)).toContain("profile_services_user_id_idx");
    expect(indexed(schema.adverts)).toContain("adverts_user_id_created_at_idx");
  });

  it("removes everything an account owns when the user is deleted", async () => {
    await testEnv.DB.prepare("DELETE FROM user WHERE id = 'u1'").run();
    for (const table of [
      "business_profiles",
      "profile_services",
      "adverts",
      "advert_images",
    ]) {
      expect(await count(table)).toBe(0);
    }
  });

  it("defaults brand colours to an empty list", async () => {
    const row = await testEnv.DB.prepare(
      "SELECT brand_colours FROM business_profiles WHERE user_id = 'u1'"
    ).first<{ brand_colours: string }>();
    expect(row?.brand_colours).toBe("[]");
  });

  it("rejects a tone outside 1 to 5", async () => {
    await expect(
      testEnv.DB.prepare("UPDATE business_profiles SET tone = 6 WHERE user_id = 'u1'").run()
    ).rejects.toThrow(/CHECK constraint failed/);
  });

  it("rejects an unknown platform", async () => {
    await expect(
      testEnv.DB.prepare(
        "INSERT INTO advert_images (advert_id, platform, r2_key, generated_at) VALUES ('a1', 'tiktok', 'k', ?1)"
      )
        .bind(NOW)
        .run()
    ).rejects.toThrow(/CHECK constraint failed/);
  });

  it("keeps one image per platform per advert", async () => {
    await expect(
      testEnv.DB.prepare(
        "INSERT INTO advert_images (advert_id, platform, r2_key, generated_at) VALUES ('a1', 'instagram', 'k2', ?1)"
      )
        .bind(NOW)
        .run()
    ).rejects.toThrow(/UNIQUE constraint failed/);
  });

  it("refuses services for an account with no profile", async () => {
    await expect(
      testEnv.DB.prepare(
        "INSERT INTO profile_services (id, user_id, name, position, created_at) VALUES ('s2', 'nobody', 'X', 0, ?1)"
      )
        .bind(NOW)
        .run()
    ).rejects.toThrow(/FOREIGN KEY constraint failed/);
  });
});

describe("R2 binding", () => {
  it("stores and reads back an object", async () => {
    await testEnv.IMAGES.put("probe.txt", "hello");
    const obj = await testEnv.IMAGES.get("probe.txt");
    expect(await obj?.text()).toBe("hello");
  });
});
