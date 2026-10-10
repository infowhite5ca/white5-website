import { z } from "zod";

export const LOCATION_MASK = "name,title,storeCode,storefrontAddress,websiteUri,phoneNumbers,categories,regularHours,specialHours,serviceArea,metadata,profile,openInfo";
const resource = (prefix: string) => z.string().regex(new RegExp(`^(?:${prefix}/)?[0-9]+$`));
const account = resource("accounts"), location = resource("locations");
const reviewName = z.string().regex(/^accounts\/\d+\/locations\/\d+\/reviews\/[A-Za-z0-9_-]+$/);
const postName = z.string().regex(/^accounts\/\d+\/locations\/\d+\/localPosts\/[A-Za-z0-9_-]+$/);
const webUrl = z.string().url().max(2048).refine(value => {
  const url = new URL(value);
  return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password;
}, "Use a public HTTP(S) URL without credentials.");
const confirmed = z.boolean().default(false);
const callToAction = z.object({ actionType: z.enum(["BOOK", "ORDER", "SHOP", "LEARN_MORE", "SIGN_UP", "CALL"]), url: webUrl.optional() }).strict().refine(v => v.actionType === "CALL" ? !v.url : Boolean(v.url), "CALL must omit url; other actions require a website URL.");
const postFields = {
  languageCode: z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/).optional(),
  summary: z.string().trim().min(1).max(1500).optional(),
  callToAction: callToAction.optional(),
  media: z.array(z.object({ mediaFormat: z.literal("PHOTO").optional(), sourceUrl: webUrl }).strict()).max(10).optional(),
};
const post = z.object({ ...postFields, topicType: z.literal("STANDARD").default("STANDARD") }).strict().refine(v => Boolean(v.summary || v.media?.length), "Provide text or a photo.");
const postPatch = z.object(postFields).strict().refine(v => Object.keys(v).length > 0, "Provide fields to update.");
const time = z.object({ hours: z.number().int().min(0).max(23).default(0), minutes: z.number().int().min(0).max(59).default(0) }).strict();
const day = z.enum(["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"]);
const date = z.object({ year: z.number().int().min(2000).max(2100), month: z.number().int().min(1).max(12), day: z.number().int().min(1).max(31) }).strict().refine(v => new Date(Date.UTC(v.year, v.month - 1, v.day)).getUTCMonth() === v.month - 1, "Invalid date.");
const locationPatch = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  websiteUri: webUrl.optional(),
  phoneNumbers: z.object({ primaryPhone: z.string().min(5).max(40), additionalPhones: z.array(z.string().min(5).max(40)).max(2).optional() }).strict().optional(),
  storefrontAddress: z.object({ regionCode: z.string().regex(/^[A-Z]{2}$/), postalCode: z.string().max(30).optional(), administrativeArea: z.string().max(100).optional(), locality: z.string().max(100).optional(), addressLines: z.array(z.string().min(1).max(300)).min(1).max(5) }).strict().optional(),
  serviceArea: z.object({ businessType: z.enum(["CUSTOMER_LOCATION_ONLY", "CUSTOMER_AND_BUSINESS_LOCATION"]), places: z.object({ placeInfos: z.array(z.object({ placeName: z.string().min(1), placeId: z.string().regex(/^[A-Za-z0-9_-]+$/) }).strict()).min(1).max(20) }).strict() }).strict().optional(),
  regularHours: z.object({ periods: z.array(z.object({ openDay: day, openTime: time, closeDay: day, closeTime: time }).strict()).max(100) }).strict().optional(),
  specialHours: z.object({ specialHourPeriods: z.array(z.object({ startDate: date, endDate: date.optional(), openTime: time.optional(), closeTime: time.optional(), closed: z.boolean().default(false) }).strict().refine(v => v.closed || Boolean(v.openTime && v.closeTime), "Open periods need opening and closing times.")).max(100) }).strict().optional(),
  profile: z.object({ description: z.string().max(750) }).strict().optional(),
}).strict().refine(v => Object.keys(v).length > 0, "Provide fields to update.");
export const METRICS = ["BUSINESS_IMPRESSIONS_DESKTOP_MAPS", "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH", "BUSINESS_IMPRESSIONS_MOBILE_MAPS", "BUSINESS_IMPRESSIONS_MOBILE_SEARCH", "BUSINESS_DIRECTION_REQUESTS", "CALL_CLICKS", "WEBSITE_CLICKS", "BUSINESS_BOOKINGS", "BUSINESS_FOOD_ORDERS", "BUSINESS_FOOD_MENU_CLICKS"] as const;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v, "Invalid date.");
const pageToken = z.string().max(4096).optional();
export const schemas = {
  connection_status: z.object({ account: account.optional(), location: location.optional() }).refine(v => !v.location || v.account, "Supply account with location."),
  list_accounts: z.object({ pageSize: z.number().int().min(1).max(20).default(20), pageToken }),
  list_locations: z.object({ account, pageSize: z.number().int().min(1).max(100).default(100), pageToken, readMask: z.string().min(1).default(LOCATION_MASK) }),
  get_location: z.object({ location, readMask: z.string().min(1).default(LOCATION_MASK) }),
  list_reviews: z.object({ account, location, pageSize: z.number().int().min(1).max(50).default(50), pageToken, orderBy: z.enum(["rating", "rating desc", "updateTime desc"]).optional() }),
  get_review: z.object({ reviewName }),
  list_posts: z.object({ account, location, pageSize: z.number().int().min(1).max(100).default(20), pageToken }),
  prepare_post: z.object({ account, location, post }),
  create_post: z.object({ account, location, post, confirmed }),
  update_post: z.object({ postName, post: postPatch, confirmed }),
  delete_post: z.object({ postName, confirmed }),
  reply_to_review: z.object({ reviewName, comment: z.string().trim().min(1).max(4096), confirmed }),
  update_location: z.object({ location, changes: locationPatch, validateOnly: z.boolean().default(true), confirmed }),
  get_performance: z.object({ location, startDate: isoDate, endDate: isoDate, metrics: z.array(z.enum(METRICS)).min(1).max(METRICS.length).default([...METRICS.slice(0, 7)]) }).refine(v => v.startDate <= v.endDate, "startDate must precede endDate."),
  get_location_permissions: z.object({ location }),
  set_primary_location: z.object({ account, location, confirmed }),
};
export type ToolName = keyof typeof schemas;
export const WRITES = new Set<ToolName>(["create_post", "update_post", "delete_post", "reply_to_review", "update_location", "set_primary_location"]);
const descriptions: Record<ToolName, string> = {
  connection_status: "Refreshes Google authorization and checks accounts. With account/location (or saved primary), checks location, posts, reviews and performance separately; reports actual API restrictions.",
  list_accounts: "List accessible Google Business Profile accounts, with pagination.",
  list_locations: "List Business Profile locations including business details, service area and Voice of Merchant status. Follow nextPageToken to find duplicates.",
  get_location: "Read business name, address/service area, phones, website, hours, metadata and profile status.",
  list_reviews: "Read location reviews, ratings and total review count. Requires Google My Business API access.",
  get_review: "Read an individual Google Business Profile review.",
  list_posts: "Read local posts. Requires Google My Business API access.",
  prepare_post: "Validate and prepare a local STANDARD post draft with text, photo URLs and call-to-action/website links. No network calls or Google draft is created.",
  create_post: "Preview a STANDARD post by default; confirmed:true publishes after explicit user approval. No server-side draft or validateOnly API exists for posts.",
  update_post: "Preview post changes by default; confirmed:true applies only supplied fields after explicit user approval.",
  delete_post: "Preview deletion of one local post; confirmed:true deletes only after explicit user approval. Never deletes business profiles.",
  reply_to_review: "Validate and preview a review reply; confirmed:true sends only after explicit user approval of the exact text.",
  update_location: "Preview validated business information changes. confirmed:true with validateOnly:true validates at Google without mutation; validateOnly:false applies after explicit approval.",
  get_performance: "Read daily Search/Maps impressions, website clicks, call clicks (not completed calls), directions and other supported metrics. Unavailable access returns an explicit capability error.",
  get_location_permissions: "Read location administrators and Voice of Merchant verification state. Each capability reports its own availability.",
  set_primary_location: "Validate an accessible White5 location with Voice of Merchant and save its account/location in private Worker KV only after explicit confirmation. Does not change the Google listing.",
};
export const toolDefinitions = (Object.keys(schemas) as ToolName[]).map(name => ({
  name, description: descriptions[name], inputSchema: z.toJSONSchema(schemas[name], { io: "input" }),
  annotations: { readOnlyHint: !WRITES.has(name), destructiveHint: name === "delete_post", openWorldHint: name !== "prepare_post" },
}));
