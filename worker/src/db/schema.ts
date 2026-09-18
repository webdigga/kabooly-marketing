import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

// better-auth tables (same shape as TrackShows)

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_id_idx").on(t.userId)]
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp" }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp" }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    index("account_user_id_idx").on(t.userId),
    // Social sign-in looks an account up by provider and provider id; without
    // this every sign-in scans the whole table (D1 bills rows read).
    index("account_provider_idx").on(t.providerId, t.accountId),
  ]
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }),
    updatedAt: integer("updated_at", { mode: "timestamp" }),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)]
);

// app tables

export const PLATFORMS = ["instagram", "facebook", "nextdoor"] as const;
export type Platform = (typeof PLATFORMS)[number];


// One per account. Its existence is what marks onboarding as done.
export const businessProfiles = sqliteTable(
  "business_profiles",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    businessName: text("business_name").notNull(),
    description: text("description").notNull(),
    websiteUrl: text("website_url"),
    targetAudience: text("target_audience").notNull(),
    localArea: text("local_area").notNull(),
    // 1 = formal through to 5 = casual.
    tone: integer("tone").notNull(),
    // Hex strings (#rrggbb), primary first.
    brandColours: text("brand_colours", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    // R2 key of the logo, whether detected from the website or uploaded.
    logoKey: text("logo_key"),
    // R2 keys of the brand strips, one per platform: the logo and website
    // address on a bar, drawn by the browser at that platform's exact size
    // when the profile is saved and stamped onto every image.
    brandStrips: text("brand_strips", { mode: "json" }).$type<Partial<Record<Platform, string>>>(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [check("business_profiles_tone_range", sql`${t.tone} BETWEEN 1 AND 5`)]
);

export const profileServices = sqliteTable(
  "profile_services",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => businessProfiles.userId, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: integer("position").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [index("profile_services_user_id_idx").on(t.userId, t.position)]
);

// What an advert is made of: generated platform images, platform images
// cut from the customer's own photo, or a carousel of slides.
export const ADVERT_FORMATS = ["images", "photo", "carousel"] as const;
export type AdvertFormat = (typeof ADVERT_FORMATS)[number];

export interface Slide {
  heading: string;
  body: string;
}

export const adverts = sqliteTable(
  "adverts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    topic: text("topic").notNull(),
    // Advert text as last saved: generated, regenerated or edited in place.
    body: text("body").notNull(),
    format: text("format", { enum: ADVERT_FORMATS }).notNull().default("images"),
    // Carousels only: the words of each slide, and the R2 key of the one
    // background image every slide is laid over (in the browser).
    slides: text("slides", { mode: "json" }).$type<Slide[]>(),
    backgroundKey: text("background_key"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  // The library lists an account's adverts newest first. (No CHECK on
  // format: adding one would rebuild the table, and on D1 dropping the old
  // table cascades to advert_images. The app only ever writes the enum.)
  (t) => [index("adverts_user_id_created_at_idx").on(t.userId, t.createdAt)]
);


// At most one image per platform per advert; regenerating replaces it.
export const advertImages = sqliteTable(
  "advert_images",
  {
    advertId: text("advert_id")
      .notNull()
      .references(() => adverts.id, { onDelete: "cascade" }),
    platform: text("platform", { enum: PLATFORMS }).notNull(),
    r2Key: text("r2_key").notNull(),
    generatedAt: integer("generated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.advertId, t.platform] }),
    check(
      "advert_images_platform_valid",
      sql`${t.platform} IN ('instagram', 'facebook', 'nextdoor')`
    ),
  ]
);

export const VIDEO_STATUSES = ["pending", "ready", "failed"] as const;
export type VideoStatus = (typeof VIDEO_STATUSES)[number];

// At most one video per advert; regenerating replaces it. A video is made in
// Google's background mode, so the row is written as pending with the job's
// id and settled by whichever request next checks on it.
export const advertVideos = sqliteTable(
  "advert_videos",
  {
    advertId: text("advert_id")
      .primaryKey()
      .references(() => adverts.id, { onDelete: "cascade" }),
    status: text("status", { enum: VIDEO_STATUSES }).notNull(),
    // The limiter lease that counted this video, refunded if it fails.
    leaseId: text("lease_id").notNull(),
    interactionId: text("interaction_id"),
    // The vertical starting image the video was animated from.
    startKey: text("start_key").notNull(),
    r2Key: text("r2_key"),
    motion: text("motion"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [check("advert_videos_status_valid", sql`${t.status} IN ('pending', 'ready', 'failed')`)]
);

// billing

export const SUBSCRIPTION_SOURCES = ["marketing", "bundle"] as const;
export type SubscriptionSource = (typeof SUBSCRIPTION_SOURCES)[number];

// What pays for an account. Accounts are only created by checkout, so every
// customer has exactly one row. `marketing` is the account's own 40 a month
// Stripe subscription; `bundle` is switched on by the customer's CRM bundle
// subscription and has no charge of its own. `active` is the only thing the
// session gate reads.
export const subscriptions = sqliteTable(
  "subscriptions",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    source: text("source", { enum: SUBSCRIPTION_SOURCES }).notNull(),
    stripeCustomerId: text("stripe_customer_id").notNull(),
    stripeSubscriptionId: text("stripe_subscription_id").notNull().unique(),
    status: text("status").notNull(),
    active: integer("active", { mode: "boolean" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    check("subscriptions_source_valid", sql`${t.source} IN ('marketing', 'bundle')`),
  ]
);

// Stripe event ids already handled, so a retried delivery is a no-op.
export const billingEvents = sqliteTable("billing_events", {
  stripeEventId: text("stripe_event_id").primaryKey(),
  type: text("type").notNull(),
  receivedAt: integer("received_at", { mode: "timestamp" }).notNull(),
});
