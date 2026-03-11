/**
 * useInsertions — TanStack Query hook for fetching paginated insertions.
 *
 * WHAT THIS HOOK DOES:
 *   Wraps the listInsertions API call with TanStack Query, which provides:
 *     - Automatic caching (don't refetch if we already have this page)
 *     - Loading / error / success states
 *     - Background refetching when data goes stale
 *     - Deduplication (if two components request the same data, only one fetch)
 *
 * WHY A CUSTOM HOOK?
 *   Components shouldn't know about fetch() or API URLs. They just call:
 *     const { data, isLoading } = useInsertions({ me_type: "ALU", limit: 50 });
 *   and get typed data back. If the API changes, we only update this hook
 *   and client.ts — not every component.
 *
 * HOW THE QUERY KEY WORKS:
 *   TanStack Query caches results by "query key" — an array that uniquely
 *   identifies a request. When any value in the key changes (e.g. the user
 *   navigates to page 2), TanStack Query refetches automatically.
 *
 *   Our key is: ["insertions", { me_type: "ALU", limit: 50, offset: 0, ... }]
 *   So changing any filter or pagination param triggers a new fetch.
 *
 * HOW COMPONENTS USE THIS:
 *   import { useInsertions } from "../hooks/useInsertions";
 *
 *   function MyPage() {
 *     const { data, isLoading, error } = useInsertions({
 *       me_type: "ALU",
 *       limit: 50,
 *       offset: 0,
 *     });
 *     // data.results = InsertionSummary[]
 *     // data.total = number of matching rows
 *   }
 */

import { useQuery } from "@tanstack/react-query";
import { listInsertions, type ListInsertionsParams } from "../api/client";

/**
 * Fetch a paginated list of insertions from the API.
 *
 * @param params - Filter and pagination parameters (me_type, limit, offset, etc.)
 * @returns TanStack Query result with data, isLoading, error, etc.
 *
 * keepPreviousData: true means when the user navigates to the next page,
 * the old page's data stays visible while the new page loads. Without this,
 * the table would flash empty on every page change.
 */
export function useInsertions(params: ListInsertionsParams = {}) {
  return useQuery({
    queryKey: ["insertions", params],
    queryFn: () => listInsertions(params),
    placeholderData: (previousData) => previousData,
  });
}
