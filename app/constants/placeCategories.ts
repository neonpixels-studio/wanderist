/**
 * Canonical set of place categories a user can assign. Shared so the map's
 * edit form and explore's category filters stay in lockstep — a place saved
 * with one of these values is always matchable by the explore filters.
 * `value` is what persists to `places.category`; `label` is the UI text.
 */
export interface PlaceCategory {
  label: string;
  value: string;
}

export const PLACE_CATEGORIES: PlaceCategory[] = [
  { label: "Nature", value: "nature" },
  { label: "Cities", value: "city" },
  { label: "Coast", value: "coast" },
  { label: "Food", value: "food" },
  { label: "Culture", value: "culture" },
];
