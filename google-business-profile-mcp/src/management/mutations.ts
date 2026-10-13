import {
  type ConnectorEnv,
  type GoogleAuthProps,
  GoogleApiError,
} from "../google-client";
import { stagePhoto } from "../media";
import {
  API,
  endpoint,
  resource,
  profile,
  pages,
  invalid,
  digest,
  canonical,
  errorData,
  type Json,
  type Request,
} from "./api";
import { mergeServices, serviceTypes } from "./services";
import { control } from "./control";
import { fullPost } from "./schemas";
type Plan = {
  before: unknown;
  after: unknown;
  target: string;
  strong?: string;
  execute: () => Promise<unknown>;
};
const clean = (object: Json, keys: string[]) =>
  Object.fromEntries(
    keys.filter((k) => object[k] !== undefined).map((k) => [k, object[k]]),
  );
export async function prepareMutation(
  env: ConnectorEnv,
  request: Request,
  name: string,
  a: Json,
): Promise<Plan> {
  const location = a.location && resource(a.location, "locations"),
    account = a.account && resource(a.account, "accounts"),
    parent = account + "/" + location;
  let before: any,
    after: any,
    target = "",
    url = "",
    method = "PATCH",
    query: Json = {},
    readUrl = "",
    strong: string | undefined;
  const readBack = async (result: Json) => {
    try {
      return {
        accepted: true,
        result,
        readBack: await request(readUrl || endpoint(API.v4, result.name)),
      };
    } catch (e) {
      return {
        accepted: true,
        result,
        readBack: errorData(e),
        verification:
          "Read-back failed; acceptance does not prove final/public state.",
      };
    }
  };
  if (name === "create_media_batch") {
    const gallery = await pages(
      request,
      endpoint(API.v4, parent + "/media", { pageSize: 100 }),
      "mediaItems",
    );
    if (!gallery.complete)
      throw invalid(
        "Current gallery is incomplete; cannot safely detect duplicates.",
      );
    const urls = new Set<string>();
    for (const item of a.items) {
      if (
        urls.has(item.sourceUrl) ||
        gallery.items.some((m) => m.sourceUrl === item.sourceUrl)
      )
        throw invalid("Repeated source URL or media already in gallery.");
      urls.add(item.sourceUrl);
    }
    const items = a.items.map((item: Json) => ({
      mediaFormat: item.mediaFormat,
      sourceUrl: item.sourceUrl,
      locationAssociation: { category: item.category },
      ...(item.description ? { description: item.description } : {}),
    }));
    return {
      before: gallery.items.map((m) =>
        clean(m, ["name", "sourceUrl", "locationAssociation"]),
      ),
      after: items,
      target: parent + "/media",
      execute: async () => {
        const results = [];
        for (let i = 0; i < items.length; i++) {
          try {
            const accepted = await request(
              endpoint(API.v4, parent + "/media"),
              { method: "POST", body: JSON.stringify(items[i]) },
            );
            results.push({ index: i, accepted: true, result: accepted });
          } catch (e) {
            results.push({ index: i, ...errorData(e) });
          }
        }
        let readBack;
        try {
          readBack = await pages(
            request,
            endpoint(API.v4, parent + "/media", { pageSize: 100 }),
            "mediaItems",
          );
        } catch (e) {
          readBack = errorData(e);
        }
        return {
          results,
          readBack,
          publicVisibility:
            "Not exposed by Google; API acceptance is not public visibility.",
        };
      },
    };
  }
  if (name === "upload_media_batch")
    return {
      before: { staged: false },
      after: {
        files: a.files.map((f: Json) =>
          clean(f, ["file_id", "file_name", "mime_type"]),
        ),
        retentionHours: 72,
        visibility: "Anyone with the resulting URLs can read the files.",
        googlePublication: false,
      },
      target: "White5 temporary media storage",
      execute: async () => {
        const results = [];
        for (const file of a.files) {
          try {
            results.push({
              file_id: file.file_id,
              ...(await stagePhoto(env, file)),
            });
          } catch (e) {
            results.push({ file_id: file.file_id, ...errorData(e) });
          }
        }
        return { published: false, results };
      },
    };
  if (name === "upload_media")
    return {
      before: { staged: false },
      after: {
        file_id: a.file.file_id,
        file_name: a.file.file_name,
        mime_type: a.file.mime_type,
        retentionHours: 72,
        visibility: "Anyone with the resulting URL can read the file.",
        googlePublication: false,
      },
      target: "White5 temporary media storage",
      execute: () => stagePhoto(env, a.file),
    };
  if (name === "update_services") {
    const current = await profile(
      request,
      location,
      "name,categories,serviceItems,metadata",
    );
    if (!current.metadata?.canModifyServiceList)
      throw invalid(
        "Google does not permit service-list modification for this profile.",
      );
    const types = await serviceTypes(request, current);
    before = {
      serviceItems: current.serviceItems || [],
      categories: current.categories,
    };
    after = {
      serviceItems: mergeServices(current.serviceItems || [], a, types),
    };
    target = location;
    url = endpoint(API.info, location, {
      updateMask: "serviceItems",
      validateOnly: a.validateOnly,
    });
    readUrl = endpoint(API.info, location, { readMask: "name,serviceItems" });
  } else if (name === "update_location") {
    const keys = Object.keys(a.changes);
    const current = await profile(
      request,
      location,
      [...new Set(["name", "metadata", "categories", ...keys])].join(","),
    );
    before = clean(current, keys);
    after = a.changes;
    target = location;
    if (after.categories) {
      const names = [
        after.categories.primaryCategory,
        ...(after.categories.additionalCategories || []),
      ].map((c: Json) => c.name);
      if (new Set(names).size !== names.length)
        throw invalid("Duplicate categories are not allowed.");
      await request(
        endpoint(API.info, "categories:batchGet", {
          names,
          languageCode: "en",
          regionCode: "CA",
          view: "FULL",
        }),
      );
    }
    if (after.moreHours) {
      const types = await serviceTypes(request, current);
      const eligible = new Set(
        (types.categories || []).flatMap((c: Json) =>
          (c.moreHoursTypes || []).map((t: Json) => t.hoursTypeId),
        ),
      );
      if (after.moreHours.some((h: Json) => !eligible.has(h.hoursTypeId)))
        throw invalid("Additional hours type is not eligible.");
    }
    url = endpoint(API.info, location, {
      updateMask: keys.join(","),
      validateOnly: a.validateOnly,
    });
    readUrl = endpoint(API.info, location, {
      readMask: ["name", ...keys].join(","),
    });
  } else if (name === "update_attributes") {
    const current = await request(endpoint(API.info, location + "/attributes"));
    const eligible = await pages(
      request,
      endpoint(API.info, "attributes", {
        parent: location,
        pageSize: 100,
      }),
      "attributeMetadata",
    );
    if (!eligible.complete)
      throw invalid(
        "Attribute metadata is incomplete; cannot safely validate updates.",
      );
    if (
      new Set(a.attributes.map((x: Json) => x.name)).size !==
      a.attributes.length
    )
      throw invalid("Duplicate attributes.");
    for (const attr of a.attributes) {
      const metadata = eligible.items.find((x) => x.parent === attr.name);
      if (!metadata || metadata.deprecated)
        throw invalid("Attribute is not eligible or is deprecated.");
      if (metadata.repeatable !== true && (attr.values?.length > 1 || attr.uriValues?.length > 1))
        throw invalid("This attribute permits only one value.");
      if(attr.uriValues?.some((v:Json)=>v.uri.startsWith("sms:"))&&attr.name!=="attributes/url_text_messaging")throw invalid("SMS URIs are only supported for the eligible text messaging attribute.");
      const count = [
        attr.values,
        attr.uriValues,
        attr.repeatedEnumValue,
      ].filter(Boolean).length;
      if (count !== 1)
        throw invalid("Supply exactly one value representation per attribute.");
      if (
        metadata.valueType === "BOOL" &&
        (!attr.values ||
          attr.values.length !== 1 ||
          typeof attr.values[0] !== "boolean")
      )
        throw invalid("Boolean attribute needs exactly one boolean.");
      const allowed = (metadata.valueMetadata || []).map((x: Json) =>
        canonical(x.value),
      );
      if (
        metadata.valueType === "ENUM" &&
        (!attr.values ||
          attr.values.some((x: any) => !allowed.includes(canonical(x))))
      )
        throw invalid("Attribute enum value is ineligible.");
      if (metadata.valueType === "URL" && !attr.uriValues)
        throw invalid("URL attribute needs uriValues.");
      if (
        metadata.valueType === "REPEATED_ENUM" &&
        (!attr.repeatedEnumValue ||
          [
            ...attr.repeatedEnumValue.setValues,
            ...attr.repeatedEnumValue.unsetValues,
          ].some((v: string) => !allowed.includes(canonical(v))))
      )
        throw invalid("Repeated enum contains ineligible values.");
      if (attr.repeatedEnumValue) {
        const values = [...attr.repeatedEnumValue.setValues, ...attr.repeatedEnumValue.unsetValues];
        if (new Set(values).size !== values.length)
          throw invalid("Repeated enum values must be unique and cannot be both set and unset.");
      }
    }
    before = current;
    after = { name: location + "/attributes", attributes: a.attributes };
    target = location + "/attributes";
    url = endpoint(API.info, target, {
      attributeMask: a.attributes.map((x: Json) => x.name).join(","),
    });
    readUrl = endpoint(API.info, target);
  } else if (["create_post", "create_media"].includes(name)) {
    const field = name === "create_post" ? "localPosts" : "media";
    const listed = await pages(
      request,
      endpoint(API.v4, parent + "/" + field, { pageSize: 100 }),
      field === "media" ? "mediaItems" : "localPosts",
    );
    if (!listed.complete)
      throw invalid(
        "Current collection is incomplete; cannot safely check for duplicates.",
      );
    before = listed.items.map((x) =>
      clean(x, [
        "name",
        "summary",
        "topicType",
        "media",
        "event",
        "offer",
        "callToAction",
        "sourceUrl",
        "locationAssociation",
      ]),
    );
    after =
      name === "create_post"
        ? a.post
        : {
            mediaFormat: a.mediaFormat || "PHOTO",
            sourceUrl: a.sourceUrl,
            locationAssociation: { category: a.category },
            ...(a.description ? { description: a.description } : {}),
          };
    if (
      name === "create_media" &&
      listed.items.some((m) => m.sourceUrl === a.sourceUrl)
    )
      throw invalid("This source URL is already in the business gallery.");
    if (
      name === "create_post" &&
      listed.items.some(
        (p) => canonical(clean(p, Object.keys(after))) === canonical(after),
      )
    )
      throw invalid("An identical post already exists.");
    target = parent + "/" + field;
    url = endpoint(API.v4, target);
    method = "POST";
  } else if (["update_post", "delete_post"].includes(name)) {
    target = a.postName;
    before = await request(endpoint(API.v4, target));
    if (name === "update_post") {
      fullPost.parse({
        ...clean(before, [
          "topicType",
          "languageCode",
          "summary",
          "callToAction",
          "event",
          "offer",
        ]),
        // Unchanged media can contain Google-only references or legacy videos.
        // Only validate new media explicitly supplied in the patch.
        ...a.post,
      });
      after = a.post;
      query = { updateMask: Object.keys(after).join(",") };
    } else {
      after = null;
      method = "DELETE";
      strong = "DELETE " + target;
    }
    url = endpoint(API.v4, target, query);
    readUrl = endpoint(API.v4, target);
  } else if (["reply_to_review", "delete_review_reply"].includes(name)) {
    target = a.reviewName;
    before = await request(endpoint(API.v4, target));
    after = name === "reply_to_review" ? { comment: a.comment } : null;
    url = endpoint(API.v4, target + "/reply");
    method = after ? "PUT" : "DELETE";
    readUrl = endpoint(API.v4, target);
    if (!after) strong = "DELETE REPLY " + target;
  } else if (["update_media", "delete_media"].includes(name)) {
    target = a.mediaName;
    before = await request(endpoint(API.v4, target));
    if (name === "delete_media") {
      after = null;
      method = "DELETE";
      strong = "DELETE " + target;
    } else {
      after = { locationAssociation: { category: a.category } };
      query = { updateMask: "locationAssociation" };
    }
    url = endpoint(API.v4, target, query);
    readUrl = endpoint(API.v4, target);
  } else if (
    ["create_action_link", "update_action_link", "delete_action_link"].includes(
      name,
    )
  ) {
    target = a.name || location + "/placeActionLinks";
    if (a.name) {
      before = await request(endpoint(API.actions, target));
      if (!before.isEditable || before.providerType !== "MERCHANT")
        throw invalid("Only merchant-owned editable links can be changed.");
      if (name === "delete_action_link") {
        method = "DELETE";
        after = null;
        strong = "DELETE " + target;
      } else {
        after = clean(a, ["uri", "isPreferred"]);
        query = { updateMask: Object.keys(after).join(",") };
      }
    } else {
      const eligible = await request(
        endpoint(API.actions, "placeActionTypeMetadata", {
          filter: "location=" + location,
          languageCode: "en",
        }),
      );
      if (
        !(eligible.placeActionTypeMetadata || []).some(
          (x: Json) => x.placeActionType === a.placeActionType,
        )
      )
        throw invalid("Google has not confirmed this action type is eligible.");
      before = await request(endpoint(API.actions, target));
      if (
        (before.placeActionLinks || []).some(
          (l: Json) =>
            l.uri === a.uri && l.placeActionType === a.placeActionType,
        )
      )
        throw invalid("This action link already exists.");
      after = clean(a, ["uri", "placeActionType", "isPreferred"]);
      method = "POST";
    }
    url = endpoint(API.actions, target, query);
    readUrl = endpoint(API.actions, a.name || target);
  } else if (name === "update_notifications") {
    target = account + "/notificationSetting";
    before = await request(endpoint(API.notifications, target));
    after = {
      name: target,
      pubsubTopic: a.pubsubTopic,
      notificationTypes: a.notificationTypes,
    };
    url = endpoint(API.notifications, target, {
      updateMask: "pubsubTopic,notificationTypes",
    });
    readUrl = endpoint(API.notifications, target);
    strong = "CONFIGURE NOTIFICATIONS " + account;
  } else if (["invite_manager", "remove_manager"].includes(name)) {
    target = a.name || location + "/admins";
    const collection = a.name
      ? a.name.split("/admins/")[0] + "/admins"
      : target;
    before = await request(endpoint(API.accounts, collection));
    if (name === "remove_manager") {
      const admin = (before.admins || []).find((x: Json) => x.name === a.name);
      if (!admin || admin.role !== "MANAGER")
        throw invalid(
          "Only an existing MANAGER can be removed. Owners are never removed.",
        );
      after = null;
      method = "DELETE";
      strong = "REMOVE MANAGER " + a.name;
    } else {
      if (
        (before.admins || []).some(
          (x: Json) => x.admin?.toLowerCase() === a.email.toLowerCase(),
        )
      )
        throw invalid("This administrator already exists.");
      after = { admin: a.email, role: "MANAGER" };
      method = "POST";
      strong = "INVITE MANAGER " + a.email;
    }
    url = endpoint(API.accounts, target);
    readUrl = endpoint(API.accounts, collection);
  } else if (name === "start_verification") {
    target = location;
    before = await request(
      endpoint(API.verification, location + ":fetchVerificationOptions"),
      {
        method: "POST",
        body: JSON.stringify({
          languageCode: "en",
          ...(a.context ? { context: a.context } : {}),
        }),
      },
    );
    const match = (before.options || []).find(
      (o: Json) =>
        o.verificationMethod === a.method &&
        (a.method === "SMS" || a.method === "PHONE_CALL"
          ? a.phoneNumber === o.phoneNumber
          : a.method === "EMAIL"
            ? a.emailAddress &&
              a.emailAddress.toLowerCase() ===
                (
                  o.emailData?.userName +
                  "@" +
                  o.emailData?.domain
                ).toLowerCase()
            : true),
    );
    if (!match)
      throw invalid(
        "Verification method/destination must match an eligible Google option.",
      );
    after = {
      ...clean(a, [
        "method",
        "phoneNumber",
        "emailAddress",
        "mailerContact",
        "context",
      ]),
      languageCode: "en",
    };
    url = endpoint(API.verification, location + ":verify");
    method = "POST";
    readUrl = endpoint(API.verification, location + "/verifications");
    strong = "VERIFY " + location;
  } else if (name === "complete_verification") {
    target = a.name;
    const collection = a.name.split("/verifications/")[0] + "/verifications";
    const list = await pages(
      request,
      endpoint(API.verification, collection, { pageSize: 100 }),
      "verifications",
    );
    before = list.items.find((x) => x.name === a.name);
    if (!before || before.state !== "PENDING")
      throw invalid("Only a pending verification can be completed.");
    after = { pin: "[redacted]" };
    url = endpoint(API.verification, target + ":complete");
    method = "POST";
    readUrl = endpoint(API.verification, collection);
    strong = "COMPLETE VERIFICATION " + target;
  } else if (name === "set_primary_location") {
    const list = await pages(
      request,
      endpoint(API.info, account + "/locations", {
        readMask: "name,title,metadata",
        pageSize: 100,
      }),
      "locations",
    );
    if (
      !list.items.some(
        (x) =>
          x.name === location &&
          /^white\s*5$/i.test(x.title) &&
          x.metadata?.hasVoiceOfMerchant &&
          !x.metadata?.duplicateLocation,
      )
    )
      throw invalid(
        "Select a verified accessible White5 profile without a duplicate marker.",
      );
    before = await env.OAUTH_KV.get("gbp-primary-location:v1", "json");
    after = { account, location };
    return {
      before,
      after,
      target: "White5 primary profile setting",
      execute: async () => {
        await env.OAUTH_KV.put(
          "gbp-primary-location:v1",
          JSON.stringify(after),
        );
        return {
          saved: true,
          readBack: await env.OAUTH_KV.get("gbp-primary-location:v1", "json"),
        };
      },
    };
  } else if (
    [
      "save_post_draft",
      "delete_post_draft",
      "schedule_job",
      "cancel_job",
    ].includes(name)
  ) {
    const id = a.draftId || a.jobId || a.generatedId,
      key = (name.includes("draft") ? "draft:" : "job:") + id;
    before = await control(env, "/get", { key });
    target = key;
    if (name === "delete_post_draft") {
      if (!before) throw invalid("Draft not found.");
      after = null;
      strong = "DELETE DRAFT " + id;
    }
    if (name === "cancel_job") {
      if (!before || before.status !== "scheduled")
        throw invalid("Only a pending scheduled job can be cancelled.");
      after = { ...before, status: "cancelled" };
    }
    if (name === "save_post_draft") {
      after = {
        id,
        account,
        location,
        post: a.post,
        updatedAt: new Date().toISOString(),
      };
    }
    if (name === "schedule_job") {
      if (Date.parse(a.runAt) < Date.now() + 60000)
        throw invalid("Choose a schedule at least one minute in the future.");
      await profile(request, location, "name,metadata");
      for (const media of a.post?.media || [])
        if (media.sourceUrl.includes(".workers.dev/media/"))
          throw invalid(
            "Scheduled posts require durable media URLs; temporary White5 uploads expire after 72 hours.",
          );
      after = {
        id,
        account,
        location,
        kind: a.kind,
        runAt: a.runAt,
        post: a.post,
        status: "scheduled",
        recurrence: [
          "weekly_report",
          "unanswered_reviews",
          "profile_changes",
        ].includes(a.kind)
          ? "Every 7 days at this UTC time"
          : a.kind === "monthly_report"
            ? "Monthly at this UTC time"
            : "Once",
        timezone: "America/Edmonton",
        displayTime: new Date(a.runAt).toLocaleString("en-CA", {
          timeZone: "America/Edmonton",
        }),
        delivery: "Stored reports only; no email or push notification",
      };
    }
    return {
      before,
      after,
      target,
      strong,
      execute: () =>
        after
          ? control(env, "/put", { key, value: after, expected:before })
          : control(env, "/delete", { key, expected:before }),
    };
  } else throw invalid("Unsupported write operation.");
  return {
    before,
    after,
    target,
    strong,
    execute: async () => {
      const result = await request(url, {
        method,
        ...(after
          ? {
              body: JSON.stringify(
                name === "complete_verification" ? { pin: a.pin } : after,
              ),
            }
          : {}),
      });
      if (a.validateOnly)
        return {
          executed: false,
          validated: true,
          validation: "google_api",
          result,
        };
      if (
        method === "DELETE" &&
        ["delete_post", "delete_media", "delete_action_link"].includes(name)
      ) {
        try {
          await request(readUrl);
          return {
            accepted: true,
            deleted: false,
            verification: "Resource remains readable after delete.",
          };
        } catch (e) {
          if (e instanceof GoogleApiError && e.status === 404)
            return { accepted: true, deleted: true, readBack: "not_found" };
          return { accepted: true, deleted: null, readBack: errorData(e) };
        }
      }
      const verified = await readBack(result);
      if (name === "create_media") {
        try {
          return {
            ...verified,
            gallery: await pages(
              request,
              endpoint(API.v4, parent + "/media", { pageSize: 100 }),
              "mediaItems",
            ),
          };
        } catch (e) {
          return { ...verified, gallery: errorData(e) };
        }
      }
      return verified;
    },
  };
}
export async function confirmedMutation(
  env: ConnectorEnv,
  props: GoogleAuthProps,
  request: Request,
  name: string,
  a: Json,
) {
  const { confirmed, previewId, destructiveConfirmation, ...input } = a;
  const argsHash = await digest(input),
    owner = props.userId,
    key = await digest({ owner, name, argsHash });
  if (confirmed && previewId) {
    const prior = await control(env, "/get", { key: "receipt:" + key });
    if (prior) return { replay: true, ...prior };
  }
  const hex = argsHash.slice(0, 32);
  const generatedId =
    hex.slice(0, 8) +
    "-" +
    hex.slice(8, 12) +
    "-4" +
    hex.slice(13, 16) +
    "-8" +
    hex.slice(17, 20) +
    "-" +
    hex.slice(20);
  const plan = await prepareMutation(env, request, name, { ...a, generatedId });
  const stateHash = await digest(plan.before);
  if (!confirmed || !previewId) {
    const approval = await control(env, "/preview", {
      owner,
      name,
      argsHash,
      stateHash,
    });
    return {
      executed: false,
      published: false,
      preview: true,
      ...approval,
      target: plan.target,
      before: plan.before,
      after: plan.after,
      destructiveConfirmationRequired: plan.strong,
      requires:
        "Approve the exact preview, then call the same operation and arguments with confirmed:true and this previewId. Changes or expired previews require new approval.",
    };
  }
  if (plan.strong && destructiveConfirmation !== plan.strong)
    throw new GoogleApiError(
      "Separate explicit confirmation is required: " + plan.strong,
      403,
      "confirmation_required",
    );
  const claim = await control(env, "/claim", {
    owner,
    name,
    argsHash,
    stateHash,
    previewId,
    key,
  });
  if (claim.replay) return claim;
  try {
    const result = await plan.execute();
    await control(env, "/finish", {
      key,
      name,
      previewId,
      status: "completed",
      result,
    });
    return result;
  } catch (e) {
    await control(env, "/finish", {
      key,
      name,
      previewId,
      status: "needs_review",
      result: errorData(e),
    });
    throw e;
  }
}
