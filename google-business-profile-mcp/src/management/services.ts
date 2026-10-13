import {
  API,
  endpoint,
  invalid,
  profile,
  canonical,
  type Json,
  type Request,
} from "./api";
export const SERVICE_NAMES = [
  "Exterior Window Cleaning",
  "Interior & Exterior Window Cleaning",
  "Glass & Mirror Cleaning",
  "Gutter Cleaning",
  "Pressure Washing",
  "Deck Cleaning",
  "Deck Sanding",
  "Deck Staining",
  "Fence Cleaning & Staining",
];
export function serviceKey(item: Json) {
  return item.structuredServiceItem
    ? "structured:" + item.structuredServiceItem.serviceTypeId
    : "custom:" +
        item.freeFormServiceItem?.category +
        ":" +
        String(item.freeFormServiceItem?.label?.displayName || "")
          .normalize("NFKC")
          .trim()
          .toLowerCase();
}
export async function serviceTypes(request: Request, current: Json) {
  const names = [
    current.categories?.primaryCategory,
    ...(current.categories?.additionalCategories || []),
  ]
    .filter(Boolean)
    .map((c) => c.name);
  if (!names.length) return { categories: [] };
  return request(
    endpoint(API.info, "categories:batchGet", {
      names,
      languageCode: "en",
      regionCode: "CA",
      view: "FULL",
    }),
  );
}
export function mergeServices(current: Json[], args: Json, types: Json) {
  const result = structuredClone(current);
  const existing = new Set(current.map(serviceKey));
  const categories = new Set((types.categories || []).map((c: Json) => c.name));
  const eligible = new Set(
    (types.categories || []).flatMap((c: Json) =>
      (c.serviceTypes || []).map((s: Json) => s.serviceTypeId),
    ),
  );
  const touched = new Set<string>();
  for (const key of args.removeKeys) {
    if (!existing.has(key))
      throw invalid(
        "Service to remove no longer exists. Refresh the service list.",
      );
    if (touched.has(key)) throw invalid("Duplicate edit key.");
    touched.add(key);
    result.splice(
      result.findIndex((service) => serviceKey(service) === key),
      1,
    );
  }
  for (const entry of args.upsert) {
    const item = entry.item,
      key = entry.key || serviceKey(item);
    if (touched.has(key))
      throw invalid(
        "A service cannot be edited twice or removed and updated together.",
      );
    touched.add(key);
    if (entry.key && !existing.has(key))
      throw invalid("Service to update no longer exists.");
    if (
      item.structuredServiceItem &&
      !eligible.has(item.structuredServiceItem.serviceTypeId)
    )
      throw invalid("Service type is not eligible for the current categories.");
    if (
      item.freeFormServiceItem &&
      !categories.has(item.freeFormServiceItem.category)
    )
      throw invalid(
        "Custom service category must belong to the current profile.",
      );
    const index = result.findIndex((s) => serviceKey(s) === key);
    if (index >= 0) result[index] = item;
    else result.push(item);
  }
  if (new Set(result.map(serviceKey)).size !== result.length)
    throw invalid("Duplicate services are not allowed.");
  if (canonical(current) === canonical(result))
    throw invalid("No service changes proposed.");
  return result;
}
export async function readServices(request: Request, location: string) {
  const current = await profile(
    request,
    location,
    "name,categories,serviceItems,metadata",
  );
  return {
    location: current.name,
    canModify: current.metadata?.canModifyServiceList === true,
    services: (current.serviceItems || []).map((item: Json) => ({
      key: serviceKey(item),
      item,
    })),
    priceMeaning:
      "Fixed price only. Missing price means no displayed fixed price.",
  };
}
export async function prepareServices(request: Request, location: string) {
  const current = await profile(
    request,
    location,
    "name,categories,serviceItems,metadata",
  );
  const types = await serviceTypes(request, current);
  const ids = [
    "job_type_id:window_cleaning",
    null,
    "job_type_id:glass_and_mirror_cleaning",
    "job_type_id:clean_gutters",
    "job_type_id:power_pressure_washing",
    null,
    null,
    null,
    null,
  ];
  const eligible = new Set(
    (types.categories || []).flatMap((c: Json) =>
      (c.serviceTypes || []).map((s: Json) => s.serviceTypeId),
    ),
  );
  const category = current.categories?.primaryCategory?.name;
  if (!category) throw invalid("Select an eligible primary category first.");
  return {
    published: false,
    requiresOwnerApproval: true,
    existingUnrelatedServicesPreserved: true,
    proposals: SERVICE_NAMES.map((name, i) => {
      const item =
        ids[i] && eligible.has(ids[i])
          ? { structuredServiceItem: { serviceTypeId: ids[i] } }
          : {
              freeFormServiceItem: {
                category,
                label: { displayName: name, languageCode: "en" },
              },
            };
      return {
        requestedName: name,
        item,
        requiresCategoryReview: !!item.freeFormServiceItem,
        note: item.structuredServiceItem
          ? "Google controls the structured service display name; the requested name is a planning label."
          : "Proposed under the current primary category. The owner must confirm this category accurately describes the service before publication.",
        existing: (current.serviceItems || []).some(
          (s: Json) => serviceKey(s) === serviceKey(item),
        ),
        price: "omitted; no fixed price approved",
      };
    }),
  };
}
