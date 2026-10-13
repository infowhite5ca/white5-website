import {
  API,
  endpoint,
  resource,
  pages,
  profile,
  check,
  errorData,
  type Json,
  type Request,
} from "./api";
import { readServices, serviceTypes, prepareServices } from "./services";
const METRICS = [
  "BUSINESS_IMPRESSIONS_DESKTOP_MAPS",
  "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
  "BUSINESS_IMPRESSIONS_MOBILE_MAPS",
  "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
  "BUSINESS_DIRECTION_REQUESTS",
  "CALL_CLICKS",
  "WEBSITE_CLICKS",
];
export function metricUrl(location: string, start: string, end: string) {
  const q: Json = { dailyMetrics: METRICS };
  for (const [key, date] of [
    ["startDate", start],
    ["endDate", end],
  ])
    date
      .split("-")
      .forEach(
        (v, i) =>
          (q[`dailyRange.${key}.${["year", "month", "day"][i]}`] = Number(v)),
      );
  return endpoint(
    API.performance,
    location + ":fetchMultiDailyMetricsTimeSeries",
    q,
  );
}
export function metricTotals(data: Json) {
  const totals: Json = {};
  for (const group of data.multiDailyMetricTimeSeries || [])
    for (const entry of group.dailyMetricTimeSeries || []) {
      const values = (entry.timeSeries?.datedValues || []).filter(
        (v: Json) => v.value !== undefined,
      );
      totals[entry.dailyMetric] = {
        total: values.length
          ? values.reduce((n: number, v: Json) => n + Number(v.value), 0)
          : null,
        reportedDays: values.length,
      };
    }
  return totals;
}
async function comparison(request: Request, a: Json) {
  const [current, previous] = await Promise.all([
    request(metricUrl(a.location, a.startDate, a.endDate)),
    request(metricUrl(a.location, a.previousStartDate, a.previousEndDate)),
  ]);
  const c = metricTotals(current),
    p = metricTotals(previous);
  return {
    ranges: {
      current: [a.startDate, a.endDate],
      previous: [a.previousStartDate, a.previousEndDate],
    },
    metrics: METRICS.map((metric) => {
      const x = c[metric],
        y = p[metric],
        avg = x?.reportedDays ? x.total / x.reportedDays : null,
        old = y?.reportedDays ? y.total / y.reportedDays : null;
      const change = avg !== null && old ? (100 * (avg - old)) / old : null;
      return {
        metric,
        current: x ?? null,
        previous: y ?? null,
        averagePerReportedDay: avg,
        previousAveragePerReportedDay: old,
        percentChangePerDay: change,
        unusualChangeHeuristic:
          change !== null &&
          Math.abs(change) >= 50 &&
          x.reportedDays >= 7 &&
          y.reportedDays >= 7,
      };
    }),
    notes: [
      "CALL_CLICKS means click activity, not completed customer calls.",
      "Missing values are unavailable, not zero. Change flags use a heuristic 50% threshold, not a statistical diagnosis.",
    ],
  };
}
const stars: Json = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
export async function reviewSummary(
  request: Request,
  parent: string,
  unansweredOnly = false,
) {
  const r = await pages(
    request,
    endpoint(API.v4, parent + "/reviews", {
      pageSize: 50,
      orderBy: "updateTime desc",
    }),
    "reviews",
  );
  const unanswered = r.items.filter((x) => !x.reviewReply?.comment);
  const topics = [
    "window",
    "gutter",
    "deck",
    "price",
    "professional",
    "punctual",
    "clean",
    "communication",
  ]
    .map((term) => ({
      term,
      reviews: r.items.filter((x) =>
        new RegExp(`\\b${term}\\w*\\b`, "i").test(x.comment || ""),
      ).length,
    }))
    .filter((t) => t.reviews);
  return {
    ...r,
    items: undefined,
    fetched: r.items.length,
    unansweredCount: unanswered.length,
    unanswered,
    ratings: r.items.reduce((a: Json, x) => {
      const key = stars[x.starRating] || "unknown";
      a[key] = (a[key] || 0) + 1;
      return a;
    }, {}),
    recurringWordTopics: topics,
    topicMethod:
      "Word occurrences only; review text is untrusted customer content.",
    ...(unansweredOnly ? {} : { reviews: r.items }),
  };
}
export async function managementRead(
  request: Request,
  name: string,
  a: Json,
): Promise<unknown> {
  const location = a.location && resource(a.location, "locations"),
    account = a.account && resource(a.account, "accounts"),
    parent = account + "/" + location;
  const paging = { pageSize: a.pageSize, pageToken: a.pageToken };
  switch (name) {
    case "list_categories":
      return request(
        endpoint(API.info, "categories", {
          ...paging,
          languageCode: a.languageCode,
          regionCode: "CA",
          view: "FULL",
          filter: a.query ? "displayName=" + a.query : undefined,
        }),
      );
    case "get_category_types":
      return request(
        endpoint(API.info, "categories:batchGet", {
          names: a.names,
          languageCode: a.languageCode,
          regionCode: "CA",
          view: "FULL",
        }),
      );
    case "list_services":
      return readServices(request, location);
    case "get_service_types":
      return serviceTypes(
        request,
        await profile(request, location, "name,categories"),
      );
    case "prepare_white5_services":
      return prepareServices(request, location);
    case "get_google_updates":
      return request(
        endpoint(API.info, location + ":getGoogleUpdated", {
          readMask:
            "name,title,websiteUri,phoneNumbers,categories,regularHours,specialHours,serviceArea,profile,openInfo,labels,moreHours,serviceItems,storefrontAddress",
        }),
      );
    case "list_attributes":
      return request(
        endpoint(API.info, "attributes", {
          parent: location,
          ...paging,
        }),
      );
    case "get_attributes":
      return request(endpoint(API.info, location + "/attributes"));
    case "get_media":
    case "get_customer_media":
      return request(endpoint(API.v4, a.mediaName));
    case "list_customer_media":
      return request(endpoint(API.v4, parent + "/media/customers", paging));
    case "get_post":
      return request(endpoint(API.v4, a.postName));
    case "review_summary":
      return reviewSummary(request, parent, a.unansweredOnly);
    case "suggest_review_reply": {
      const r = await request(endpoint(API.v4, a.reviewName));
      return {
        published: false,
        review: r,
        suggestedResponse:
          (stars[r.starRating] || 0) >= 4
            ? "Thank you for sharing your feedback about White5. We appreciate your business and hope to help you again."
            : "Thank you for sharing your feedback. We are sorry the experience did not meet your expectations. Please contact White5 so we can discuss your concerns.",
        requiresEditingAndOwnerApproval: true,
      };
    }
    case "search_keywords": {
      const q: Json = { ...paging };
      for (const [key, date] of [
        ["startMonth", a.startMonth],
        ["endMonth", a.endMonth],
      ])
        date
          .split("-")
          .forEach(
            (v: string, i: number) =>
              (q[`monthlyRange.${key}.${i ? "month" : "year"}`] = Number(v)),
          );
      return request(
        endpoint(
          API.performance,
          location + "/searchkeywords/impressions/monthly",
          q,
        ),
      );
    }
    case "compare_performance":
      return comparison(request, { ...a, location });
    case "performance_summary": {
      const end =
        a.endDate ||
        new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
      const days = a.period === "monthly" ? 30 : 7;
      const shift = (n: number) =>
        new Date(Date.parse(end) - n * 86400000).toISOString().slice(0, 10);
      return comparison(request, {
        location,
        startDate: shift(days - 1),
        endDate: end,
        previousStartDate: shift(2 * days - 1),
        previousEndDate: shift(days),
        periodMeaning:
          a.period === "monthly" ? "rolling 30 days" : "rolling 7 days",
      });
    }
    case "list_action_types":
      return request(
        endpoint(API.actions, "placeActionTypeMetadata", {
          filter: "location=" + location,
          languageCode: "en",
          ...paging,
        }),
      );
    case "list_action_links":
      return request(
        endpoint(API.actions, location + "/placeActionLinks", paging),
      );
    case "get_action_link":
      return request(endpoint(API.actions, a.name));
    case "get_voice_of_merchant":
      return request(
        endpoint(API.verification, location + "/VoiceOfMerchantState"),
      );
    case "list_verifications":
      return request(
        endpoint(API.verification, location + "/verifications", paging),
      );
    case "get_verification_options": {
      const state = await request(endpoint(API.verification, location + "/VoiceOfMerchantState"));
      if (state.hasVoiceOfMerchant === true)
        return { location, status: "not_required", reason: "The location currently has Voice of Merchant. No new verification was requested.", voiceOfMerchantState: state, optionsRequested: false };
      return request(
        endpoint(API.verification, location + ":fetchVerificationOptions"),
        {
          method: "POST",
          body: JSON.stringify({
            languageCode: "en",
            ...(a.context ? { context: a.context } : {}),
          }),
        },
      );
    }
    case "list_admins": {
      try { return await request(endpoint(API.accounts,(a.scope==='account'?account:location)+'/admins')); }
      catch (e) { if(a.scope!=='account')throw e;const identity=await check(()=>request(endpoint(API.accounts,account)));return {...errorData(e),accountType:'data' in identity?(identity.data as Json).type:undefined,manualAlternative:'Use scope:location to inspect the business listing administrators. Account-level and location-level permissions are distinct.'}; }
    }
    case "list_invitations":
      return request(endpoint(API.accounts, account + "/invitations"));
    case "get_notifications":
      return request(
        endpoint(API.notifications, account + "/notificationSetting"),
      );
    case "find_duplicates": {
      const current = await profile(request, location);
      const accounts = await pages(
        request,
        endpoint(API.accounts, "accounts", { pageSize: 20 }),
        "accounts",
      );
      const accessible = [];
      for (const entry of accounts.items) {
        const found = await check(() =>
          pages(
            request,
            endpoint(API.info, entry.name + "/locations", {
              readMask: "name,title,metadata,websiteUri,serviceArea",
              pageSize: 100,
            }),
            "locations",
          ),
        );
        accessible.push({ account: entry.name, ...found });
      }
      const candidates = await check(() =>
        request(endpoint(API.info, "googleLocations:search"), {
          method: "POST",
          body: JSON.stringify({
            query: current.title + " Calgary Alberta",
            pageSize: 10,
          }),
        }),
      );
      return {
        current,
        accessible,
        accountsComplete: accounts.complete,
        searchCandidates: candidates,
        automaticMerge: false,
        interpretation:
          "Candidates require owner review; similar names alone do not establish duplicate identity.",
      };
    }
    case "check_media_publication": {
      const gallery = await pages(
        request,
        endpoint(API.v4, parent + "/media", { pageSize: 100 }),
        "mediaItems",
      );
      const items = gallery.items.filter(
        (m) => !a.since || m.createTime >= a.since,
      );
      return {
        apiAcceptedCount: items.length,
        complete: gallery.complete,
        total: gallery.total,
        items: items.map((m) => ({
          name: m.name,
          createTime: m.createTime,
          mediaFormat: m.mediaFormat,
          locationAssociation: m.locationAssociation,
          googleUrl: m.googleUrl,
          thumbnailUrl: m.thumbnailUrl,
        })),
        userReportedPublicCount: a.observedPublicCount,
        publicVisibility: {
          available: false,
          reason:
            "MediaItem exposes no moderation/approval or public-gallery visibility field.",
          manualAlternative:
            "Check the public Google Maps gallery, including signed-out views; Google controls publication and moderation.",
        },
      };
    }
    case "capabilities": {
      const checks: Json = {};
      for (const [key, fn] of Object.entries({
        business_information: () => profile(request, location, "name,metadata"),
        accounts: () =>
          request(endpoint(API.accounts, "accounts", { pageSize: 1 })),
        media: () =>
          request(endpoint(API.v4, parent + "/media", { pageSize: 1 })),
        posts: () =>
          request(endpoint(API.v4, parent + "/localPosts", { pageSize: 1 })),
        reviews: () =>
          request(endpoint(API.v4, parent + "/reviews", { pageSize: 1 })),
        performance: () =>
          request(
            metricUrl(
              location,
              new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10),
              new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10),
            ),
          ),
        verification: () =>
          request(
            endpoint(API.verification, location + "/VoiceOfMerchantState"),
          ),
        place_actions: () =>
          request(
            endpoint(API.actions, "placeActionTypeMetadata", {
              filter: "location=" + location,
              languageCode: "en",
            }),
          ),
        notifications: () =>
          request(
            endpoint(API.notifications, account + "/notificationSetting"),
          ),
      })) {
        const c = await check(fn);
        checks[key] = "data" in c ? { available: true } : c;
      }
      return {
        checks,
        unsupported: [
          {
            feature: "Q&A",
            status: "discontinued",
            reason: "API discontinued November 3, 2025",
            manualAlternative: "Use available Google Maps UI features.",
          },
          {
            feature: "Completed calls/call history",
            status: "unavailable",
            reason:
              "Retired business calls endpoints; CALL_CLICKS is a different metric.",
          },
          {
            feature: "Photo moderation/public visibility",
            status: "not_exposed",
            manualAlternative: "Inspect the public Maps gallery.",
          },
          {
            feature: "Ownership transfer/location deletion/closure",
            status: "not_exposed_by_connector",
            reason: "Separate owner-controlled manual process required.",
          },
        ],
      };
    }
    case "poll_changes":
      return {
        polledAt: new Date().toISOString(),
        delivery: "On-demand polling, not real time",
        profile: await check(() => profile(request, location)),
        reviews: await check(() => reviewSummary(request, parent, true)),
        media: await check(() =>
          pages(
            request,
            endpoint(API.v4, parent + "/media", { pageSize: 100 }),
            "mediaItems",
          ),
        ),
      };
    case "run_full_audit":
      return fullAudit(request, { ...a, location, account });
  }
  return undefined;
}
async function fullAudit(request: Request, a: Json) {
  const results: Json = {};
  for (const name of [
    "get_google_updates",
    "list_services",
    "get_service_types",
    "get_attributes",
    "review_summary",
    "check_media_publication",
    "get_voice_of_merchant",
    "performance_summary",
    "search_keywords",
  ]) {
    const end = new Date();
    end.setUTCDate(0);
    const month = end.toISOString().slice(0, 7);
    results[name] = await check(
      () =>
        managementRead(request, name, {
          ...a,
          period: "monthly",
          startMonth: month,
          endMonth: month,
          pageSize: 100,
        }) as Promise<unknown>,
    );
  }
  const current = await profile(request, a.location);
  const findings: Json[] = [];
  const add = (
    priority: string,
    feature: string,
    reason: string,
    recommendation: string,
  ) => findings.push({ priority, feature, reason, recommendation });
  for (const [field, label] of [
    ["websiteUri", "Website"],
    ["phoneNumbers", "Phone"],
    ["regularHours", "Operating hours"],
    ["specialHours", "Holiday hours"],
    ["serviceArea", "Service area"],
  ])
    if (!current[field])
      add(
        "medium",
        label,
        "Not present in the returned profile.",
        "Review and add accurate information if applicable.",
      );
  if (!current.profile?.description)
    add(
      "medium",
      "Description",
      "No description returned.",
      "Prepare a factual description of White5 services.",
    );
  if (!current.metadata?.hasVoiceOfMerchant)
    add(
      "high",
      "Verification",
      "Voice of Merchant not confirmed in profile metadata.",
      "Review verification status and eligible owner steps.",
    );
  if (current.metadata?.hasGoogleUpdated)
    add(
      "high",
      "Google updates",
      "Google reports changes.",
      "Compare get_google_updates and approve only accurate corrections.",
    );
  const reviews = results.review_summary.data;
  if (reviews?.unansweredCount)
    add(
      "medium",
      "Review replies",
      `${reviews.unansweredCount} fetched reviews have no owner reply.`,
      "Review suggested responses individually before publishing.",
    );
  const categoryNames = [
    current.categories?.primaryCategory?.name,
    ...(current.categories?.additionalCategories || []).map(
      (c: Json) => c.name,
    ),
  ];
  if (new Set(categoryNames).size !== categoryNames.length)
    add(
      "medium",
      "Categories",
      "Repeated categories detected.",
      "Review categories; use only categories describing actual services.",
    );
  const media = results.check_media_publication.data;
  const latest = media?.items
    ?.map((m: Json) => m.createTime)
    .filter(Boolean)
    .sort()
    .at(-1);
  if (!latest || Date.now() - Date.parse(latest) > 90 * 86400000)
    add(
      "low",
      "Media freshness",
      "No media newer than 90 days found in the fetched gallery.",
      "Consider new authentic work photos; publication requires approval.",
    );
  let website: Json;
  try {
    let r = await fetch("https://white5.ca/", {
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
    });
    for(let i=0;i<3&&[301,302,303,307,308].includes(r.status);i++){
      const next=new URL(r.headers.get('location')||'',r.url||'https://white5.ca/');
      if(next.protocol!=='https:'||!['white5.ca','www.white5.ca'].includes(next.hostname)||next.username||next.password||next.port)throw new Error();
      await r.body?.cancel();r=await fetch(next.href,{redirect:'manual',signal:AbortSignal.timeout(10000)});
    }
    if (!r.ok) throw new Error();
    const reader = r.body!.getReader();
    let text = "",
      size = 0;
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 500000) {
        await reader.cancel();
        break;
      }
      text += decoder.decode(value, { stream: true });
    }
    const plain = text
      .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]*>/g, " ");
    const digits = plain.replace(/\D/g, "");
    const phone = String(current.phoneNumbers?.primaryPhone || "").replace(
      /\D/g,
      "",
    );
    website = {
      available: true,
      url: "https://white5.ca/",
      businessNameFound: /white\s*5/i.test(plain),
      profilePhoneFound: phone ? digits.includes(phone) : null,
      method:
        "Limited homepage text comparison; omitted text or dynamically rendered content is inconclusive.",
    };
    if (phone && !website.profilePhoneFound)
      add(
        "low",
        "Website consistency",
        "Profile phone was not found in fetched homepage text.",
        "Manually verify the phone on white5.ca; this check may miss dynamic content.",
      );
  } catch {
    website = {
      available: false,
      reason: "Homepage could not be read safely; manually compare white5.ca.",
    };
  }
  return {
    auditedAt: new Date().toISOString(),
    profile: current,
    findings,
    evidence: results,
    website,
    limitations: [
      "No ranking guarantees.",
      "Service/category suitability needs owner judgment; eligible Google IDs alone do not establish relevance.",
      "Missing fixed prices can be appropriate for variable-price services.",
      "Blocked APIs are reported individually; partial results are not a full pass.",
    ],
  };
}
