import { z } from "zod";
export const PRIMARY_LOCATION = "locations/8623115222428082795";
export const PRIMARY_ACCOUNT = "accounts/115421274606058010150";
export const locationId = z
  .string()
  .regex(/^(?:locations\/)?\d+$/)
  .default(PRIMARY_LOCATION);
export const accountId = z
  .string()
  .regex(/^(?:accounts\/)?\d+$/)
  .default(PRIMARY_ACCOUNT);
export const url = z
  .string()
  .url()
  .max(2048)
  .refine((v) => {
    const u = new URL(v);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.port &&
      !/^(localhost|.*\.local|\[.*\]|[\d.]+)$/.test(u.hostname)
    );
  }, "Use a public HTTPS URL without credentials.");
export const approvalFields = {
  previewId: z.string().uuid().optional(),
  idempotencyKey: z
    .string()
    .min(8)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
  destructiveConfirmation: z.string().max(500).optional(),
};
const write = { confirmed: z.boolean().default(false), ...approvalFields };
const location = { location: locationId },
  parent = { account: accountId, location: locationId };
const paging = {
  pageSize: z.number().int().min(1).max(100).default(100),
  pageToken: z.string().max(4096).optional(),
};
export const categoryId = z.string().regex(/^categories\/gcid:[a-z0-9_]+$/);
export const serviceItem = z
  .object({
    structuredServiceItem: z
      .object({
        serviceTypeId: z.string().regex(/^job_type_id:[a-z0-9_]+$/),
        description: z.string().max(300).optional(),
      })
      .strict()
      .optional(),
    freeFormServiceItem: z
      .object({
        category: categoryId,
        label: z
          .object({
            displayName: z.string().trim().min(1).max(140),
            description: z.string().max(250).optional(),
            languageCode: z.string().max(20).default("en"),
          })
          .strict(),
      })
      .strict()
      .optional(),
    price: z
      .object({
        currencyCode: z.literal("CAD"),
        units: z.string().regex(/^(0|[1-9]\d{0,8})$/),
        nanos: z.number().int().min(0).max(999999999).default(0),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (v) => Boolean(v.structuredServiceItem) !== Boolean(v.freeFormServiceItem),
    "Supply exactly one structured or custom service.",
  );
const key = z.string().min(1).max(500);
const mediaName = z
  .string()
  .regex(/^accounts\/\d+\/locations\/\d+\/media\/[A-Za-z0-9_-]+$/);
const postName = z
  .string()
  .regex(/^accounts\/\d+\/locations\/\d+\/localPosts\/[A-Za-z0-9_-]+$/);
const reviewName = z
  .string()
  .regex(/^accounts\/\d+\/locations\/\d+\/reviews\/[A-Za-z0-9_-]+$/);
const actionName = z
  .string()
  .regex(/^locations\/\d+\/placeActionLinks\/[A-Za-z0-9_-]+$/);
const category = z.enum([
  "COVER",
  "PROFILE",
  "EXTERIOR",
  "INTERIOR",
  "PRODUCT",
  "AT_WORK",
  "FOOD_AND_DRINK",
  "MENU",
  "COMMON_AREA",
  "ROOMS",
  "TEAMS",
  "ADDITIONAL",
]);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      Number.isFinite(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
    "Invalid date.",
  );
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const instant = z
  .string()
  .datetime({ offset: true })
  .describe(
    "Exact ISO timestamp including UTC offset. Display the corresponding America/Edmonton time before approval.",
  );
const attribute = z
  .object({
    name: z.string().regex(/^attributes\/[a-zA-Z0-9_]+$/),
    values: z
      .array(z.union([z.boolean(), z.string().max(500)]))
      .max(50)
      .optional(),
    uriValues: z
      .array(z.object({ uri: z.union([url,z.string().regex(/^sms:\+[1-9]\d{7,14}$/)]) }).strict())
      .max(10)
      .optional(),
    repeatedEnumValue: z
      .object({
        setValues: z.array(z.string().max(100)).max(50).default([]),
        unsetValues: z.array(z.string().max(100)).max(50).default([]),
      })
      .strict()
      .optional(),
  })
  .strict();
const address = z
  .object({
    regionCode: z.literal("CA"),
    administrativeArea: z.string().max(100),
    locality: z.string().max(100),
    postalCode: z.string().max(20),
    addressLines: z.array(z.string().max(200)).min(1).max(5),
  })
  .strict();
const context = z.object({ address }).strict().optional();
const postDate = z
  .object({
    year: z.number().int().min(2020).max(2100),
    month: z.number().int().min(1).max(12),
    day: z.number().int().min(1).max(31),
  })
  .strict()
  .refine(
    (v) =>
      new Date(Date.UTC(v.year, v.month - 1, v.day)).getUTCMonth() ===
      v.month - 1,
    "Invalid date.",
  );
const postTime = z
  .object({
    hours: z.number().int().min(0).max(23).default(0),
    minutes: z.number().int().min(0).max(59).default(0),
    seconds: z.number().int().min(0).max(59).default(0),
  })
  .strict();
const event = z
  .object({
    title: z.string().trim().min(1).max(58),
    schedule: z
      .object({
        startDate: postDate,
        endDate: postDate,
        startTime: postTime.optional(),
        endTime: postTime.optional(),
      })
      .strict(),
  })
  .strict()
  .refine((v) => {
    const s = v.schedule;
    const value = (d: any, t: any) =>
      Date.UTC(
        d.year,
        d.month - 1,
        d.day,
        t?.hours || 0,
        t?.minutes || 0,
        t?.seconds || 0,
      );
    return value(s.startDate, s.startTime) <= value(s.endDate, s.endTime);
  }, "Event end must not precede its start.");
export const postShape = {
  topicType: z.enum(["STANDARD", "EVENT", "OFFER"]).default("STANDARD"),
  languageCode: z.string().max(20).optional(),
  summary: z.string().trim().min(1).max(1500).optional(),
  media: z
    .array(
      z
        .object({ mediaFormat: z.literal("PHOTO").optional(), sourceUrl: url })
        .strict(),
    )
    .max(10)
    .optional(),
  callToAction: z
    .object({
      actionType: z.enum([
        "BOOK",
        "ORDER",
        "SHOP",
        "LEARN_MORE",
        "SIGN_UP",
        "CALL",
      ]),
      url: url.optional(),
    })
    .strict()
    .refine(
      (v) => (v.actionType === "CALL" ? !v.url : Boolean(v.url)),
      "CALL omits URL; other CTAs require it.",
    )
    .optional(),
  event: event.optional(),
  offer: z
    .object({
      couponCode: z.string().max(100).optional(),
      redeemOnlineUrl: url.optional(),
      termsConditions: z.string().max(5000).optional(),
    })
    .strict()
    .optional(),
};
export const fullPost = z
  .object(postShape)
  .strict()
  .refine(
    (v) => Boolean(v.summary || v.media?.length),
    "Provide text or a photo.",
  )
  .refine(
    (v) =>
      v.topicType === "STANDARD" ? !v.event && !v.offer : Boolean(v.event),
    "EVENT/OFFER requires an event schedule; STANDARD cannot contain an event/offer.",
  )
  .refine(
    (v) => (v.topicType === "OFFER" ? !v.callToAction : !v.offer),
    "Offer content belongs only to OFFER; use its redeem link instead of CTA.",
  );
export const extendedPostPatch = z
  .object({
    ...postShape,
    topicType: postShape.topicType.removeDefault().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Supply fields to update.");

export const managementSchemas = {
  create_media_batch: z.object({
    ...parent,
    items: z
      .array(
        z
          .object({
            sourceUrl: url,
            mediaFormat: z.enum(["PHOTO", "VIDEO"]).default("PHOTO"),
            category: category.default("ADDITIONAL"),
            description: z.string().max(1500).optional(),
          })
          .strict()
          .refine(
            (v) => v.category !== "COVER" || !v.description,
            "COVER cannot have a description.",
          ),
      )
      .min(1)
      .max(10),
    ...write,
  }),
  capabilities: z.object(parent),
  list_categories: z.object({
    query: z.string().max(100).optional(),
    languageCode: z.string().max(20).default("en"),
    ...paging,
  }),
  get_category_types: z.object({
    names: z.array(categoryId).min(1).max(20),
    languageCode: z.string().max(20).default("en"),
  }),
  get_google_updates: z.object(location),
  find_duplicates: z.object(parent),
  list_services: z.object(location),
  get_service_types: z.object(location),
  prepare_white5_services: z.object(location),
  update_services: z
    .object({
      ...location,
      upsert: z
        .array(z.object({ key: key.optional(), item: serviceItem }).strict())
        .max(100)
        .default([]),
      removeKeys: z.array(key).max(100).default([]),
      validateOnly: z.boolean().default(true),
      ...write,
    })
    .strict()
    .refine(
      (v) => v.upsert.length + v.removeKeys.length > 0,
      "Supply services to upsert or remove.",
    ),
  list_attributes: z.object({ ...location, ...paging }),
  get_attributes: z.object(location),
  update_attributes: z
    .object({
      ...location,
      attributes: z.array(attribute).min(1).max(100),
      ...write,
    })
    .strict(),
  get_media: z.object({ mediaName }),
  list_customer_media: z.object({ ...parent, ...paging }),
  get_customer_media: z.object({
    mediaName: z
      .string()
      .regex(
        /^accounts\/\d+\/locations\/\d+\/media\/customers\/[A-Za-z0-9_-]+$/,
      ),
  }),
  update_media: z
    .object({
      mediaName,
      category: category.exclude(["COVER", "PROFILE"]),
      ...write,
    })
    .strict(),
  delete_media: z.object({ mediaName, ...write }).strict(),
  check_media_publication: z.object({
    ...parent,
    since: date.optional(),
    observedPublicCount: z.number().int().min(0).optional(),
  }),
  get_post: z.object({ postName }),
  save_post_draft: z.object({
    ...parent,
    draftId: z.string().uuid().optional(),
    post: fullPost,
    ...write,
  }),
  list_post_drafts: z.object({}),
  get_post_draft: z.object({ draftId: z.string().uuid() }),
  delete_post_draft: z.object({ draftId: z.string().uuid(), ...write }),
  review_summary: z.object({
    ...parent,
    unansweredOnly: z.boolean().default(false),
  }),
  suggest_review_reply: z.object({ reviewName }),
  delete_review_reply: z.object({ reviewName, ...write }),
  search_keywords: z
    .object({ ...location, startMonth: month, endMonth: month, ...paging })
    .refine((v) => v.startMonth <= v.endMonth, "Invalid month range."),
  compare_performance: z
    .object({
      ...location,
      startDate: date,
      endDate: date,
      previousStartDate: date,
      previousEndDate: date,
    })
    .refine(
      (v) =>
        v.startDate <= v.endDate && v.previousStartDate <= v.previousEndDate,
      "Invalid date range.",
    ),
  performance_summary: z.object({
    ...location,
    period: z.enum(["weekly", "monthly"]).default("weekly"),
    endDate: date.optional(),
  }),
  list_action_types: z.object({ ...location, ...paging }),
  list_action_links: z.object({ ...location, ...paging }),
  get_action_link: z.object({ name: actionName }),
  create_action_link: z.object({
    ...location,
    uri: url,
    placeActionType: z.enum([
      "APPOINTMENT",
      "ONLINE_APPOINTMENT",
      "DINING_RESERVATION",
      "FOOD_ORDERING",
      "FOOD_DELIVERY",
      "FOOD_TAKEOUT",
      "SHOP_ONLINE",
      "SOLOPRENEUR_APPOINTMENT",
    ]),
    isPreferred: z.boolean().default(false),
    ...write,
  }),
  update_action_link: z
    .object({
      name: actionName,
      uri: url.optional(),
      isPreferred: z.boolean().optional(),
      ...write,
    })
    .refine(
      (v) => v.uri !== undefined || v.isPreferred !== undefined,
      "Supply changes.",
    ),
  delete_action_link: z.object({ name: actionName, ...write }),
  get_voice_of_merchant: z.object(location),
  list_verifications: z.object({ ...location, ...paging }),
  get_verification_options: z.object({ ...location, context }),
  start_verification: z.object({
    ...location,
    method: z.enum(["ADDRESS", "EMAIL", "PHONE_CALL", "SMS", "AUTO"]),
    phoneNumber: z.string().max(40).optional(),
    emailAddress: z.string().email().optional(),
    mailerContact: z.string().max(200).optional(),
    context,
    ...write,
  }),
  complete_verification: z.object({
    name: z.string().regex(/^locations\/\d+\/verifications\/[A-Za-z0-9_-]+$/),
    pin: z.string().regex(/^[a-zA-Z0-9-]{3,20}$/),
    ...write,
  }),
  list_admins: z.object({
    ...parent,
    scope: z.enum(["location", "account"]).default("location"),
  }),
  list_invitations: z.object({ account: accountId }),
  invite_manager: z.object({
    ...location,
    email: z.string().email(),
    ...write,
  }),
  remove_manager: z.object({
    name: z.string().regex(/^locations\/\d+\/admins\/[A-Za-z0-9_-]+$/),
    ...write,
  }),
  get_notifications: z.object({ account: accountId }),
  update_notifications: z.object({
    account: accountId,
    pubsubTopic: z
      .string()
      .regex(
        /^(projects\/[a-z][a-z0-9-]{4,62}\/topics\/[A-Za-z][A-Za-z0-9._~+%-]{2,254})?$/,
      ),
    notificationTypes: z
      .array(
        z.enum([
          "GOOGLE_UPDATE",
          "NEW_REVIEW",
          "UPDATED_REVIEW",
          "NEW_CUSTOMER_MEDIA",
          "DUPLICATE_LOCATION",
          "VOICE_OF_MERCHANT_UPDATED",
        ]),
      )
      .max(6),
    ...write,
  }),
  poll_changes: z.object(parent),
  run_full_audit: z.object(parent),
  schedule_job: z
    .object({
      ...parent,
      kind: z.enum([
        "post",
        "weekly_report",
        "monthly_report",
        "unanswered_reviews",
        "media_followup",
        "profile_changes",
      ]),
      runAt: instant,
      post: fullPost.optional(),
      ...write,
    })
    .refine(
      (v) => v.kind !== "post" || Boolean(v.post),
      "A scheduled post needs exact content.",
    ),
  list_jobs: z.object({}),
  cancel_job: z.object({ jobId: z.string().uuid(), ...write }),
  list_reports: z.object({}),
  get_audit_log: z.object({
    limit: z.number().int().min(1).max(100).default(50),
  }),
};
export const MANAGEMENT_WRITES = new Set<string>([
  "update_services",
  "update_attributes",
  "update_media",
  "delete_media",
  "save_post_draft",
  "delete_post_draft",
  "delete_review_reply",
  "create_action_link",
  "update_action_link",
  "delete_action_link",
  "start_verification",
  "complete_verification",
  "invite_manager",
  "remove_manager",
  "update_notifications",
  "schedule_job",
  "cancel_job",
]);
MANAGEMENT_WRITES.add("create_media_batch");
export const managementDescriptions: Record<
  keyof typeof managementSchemas,
  string
> = {
  create_media_batch:
    "Preview and confirm up to ten exact gallery uploads. Detect repeated source URLs, publish approved items independently, return per-item acceptance/errors and read back the gallery. Never automatically retry unknown outcomes. API acceptance does not imply public visibility.",
  capabilities:
    "Check actual GBP API access and report supported, restricted, discontinued and manual-only capabilities.",
  list_categories:
    "Search official Canadian business categories; never add categories merely for keywords.",
  get_category_types:
    "Get full category metadata including eligible structured service IDs and additional hours types.",
  get_google_updates:
    "Compare owner-submitted profile with Google's current values, diffMask and pendingMask.",
  find_duplicates:
    "Find possible duplicates via accessible accounts and official Google location search. Never merge or delete.",
  list_services:
    "Read all structured/custom serviceItems with stable edit keys. Money is a fixed CAD price, never a starting price.",
  get_service_types:
    "Retrieve Google-provided service IDs eligible for this profile's current categories.",
  prepare_white5_services:
    "Prepare nine requested White5 services without publishing or inventing prices; preserve existing unrelated services.",
  update_services:
    "Merge explicitly identified service changes, preserving unrelated entries. Preview current/proposed serviceItems, detect duplicates and stale state, confirm exact preview, then validateOnly or publish and read back. Prices are fixed CAD Money; omit price for variable pricing.",
  list_attributes: "List attributes currently eligible for this location.",
  get_attributes: "Read current profile attributes.",
  update_attributes:
    "Preview eligible typed attribute changes with a narrow attributeMask. Confirm exact preview to publish and read back.",
  get_media:
    "Get business-owned media metadata. The API exposes no public visibility/moderation approval field.",
  list_customer_media:
    "List customer-contributed media with required attribution; no modification of customer media.",
  get_customer_media: "Read one customer media item preserving attribution.",
  update_media:
    "Preview only the supported media category/locationAssociation change; description/source/format edits are not supported.",
  delete_media:
    "Separately confirm deletion of one business-owned media item. Never deletes customer media or locations.",
  check_media_publication:
    "Read gallery acceptance evidence and recent uploads; API presence or Google-hosted URLs do not prove public visibility. Compare user-observed count without inventing moderation status.",
  get_post: "Read an individual local post including the official post state.",
  save_post_draft:
    "Save an exact STANDARD/EVENT/OFFER draft privately in White5 after preview confirmation; does not publish.",
  list_post_drafts: "List private White5 post drafts.",
  get_post_draft: "Read one private White5 post draft.",
  delete_post_draft: "Delete a private draft after separate confirmation.",
  review_summary:
    "Paginate reviews; return ratings, counts, unanswered reviews and evidence-based recurring word themes. No fake reviews.",
  suggest_review_reply:
    "Prepare an editable reply suggestion grounded in the selected review. Never sends.",
  delete_review_reply:
    "Separately confirm deletion of the owner's reply, then read back the review. Cannot delete a customer review.",
  search_keywords:
    "Get monthly search keyword impressions. Preserve threshold vs exact-count semantics; no invented low-volume counts.",
  compare_performance:
    "Compare daily totals and per-day averages across two ranges; call clicks are not completed calls and missing data is not zero.",
  performance_summary:
    "Weekly/monthly daily-metric summary, comparison and explicitly heuristic unusual-change flags.",
  list_action_types:
    "Discover place action types actually eligible for this location. Do not assume quote/WhatsApp links exist.",
  list_action_links: "Read current place action links.",
  get_action_link: "Read one action link and its editable/provider status.",
  create_action_link:
    "Preview a link only after verifying the action type is eligible for this location. Confirm exact preview, publish and read back.",
  update_action_link:
    "Preview URI/preferred changes to a merchant-editable action link.",
  delete_action_link: "Separately confirm removal of one editable action link.",
  get_voice_of_merchant:
    "Read official Voice of Merchant state, reporting API enablement failures accurately.",
  list_verifications: "Read paginated verification history.",
  get_verification_options:
    "Discover eligible verification methods without starting verification; service-area businesses may need address context.",
  start_verification:
    "Owner-approved verification step using only an eligible method/destination. Separate confirmation required; never transfers ownership.",
  complete_verification:
    "Owner-approved completion of a pending verification using its PIN. PIN is never returned in previews/logs.",
  list_admins: "Read account/location administrators and roles.",
  list_invitations: "Read pending account invitations.",
  invite_manager:
    "Invite a MANAGER only, after exact email preview and separate security confirmation. Owner grants/transfers are not exposed.",
  remove_manager:
    "Remove only a non-owner MANAGER after separate security confirmation; never removes owners.",
  get_notifications:
    "Read Google Pub/Sub notification configuration; no Q&A notification types.",
  update_notifications:
    "Preview linking an already-provisioned Pub/Sub topic and supported event types. Does not provision IAM/topic/subscription; separate confirmation required.",
  poll_changes:
    "On-demand polling snapshot of reviews, profile and media. Not real-time; compare with prior stored report when present.",
  run_full_audit:
    "Read-only comprehensive GBP audit: completeness, services, attributes, categories, media, reviews, Google changes, performance, keywords and consistency with white5.ca. Recommendations have evidence and no ranking guarantees.",
  schedule_job:
    "Preview exact America/Edmonton time and content of an optional job. Only confirmed approved jobs activate alarms. Posts publish once; reports/reminders poll weekly/monthly and are available through list_reports, not email/push.",
  list_jobs: "List approved jobs and their execution states.",
  cancel_job: "Cancel a future job after preview confirmation.",
  list_reports:
    "Read stored scheduled reports and polling reminders; no external messages are sent.",
  get_audit_log:
    "Read sanitized operation outcomes and scheduled job events; no credentials, signed input URLs or verification PINs.",
};
