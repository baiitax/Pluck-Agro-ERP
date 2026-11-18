import { Skeleton } from "@/components/ui/skeleton";

export default function MasterDataLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading master data">
      <Skeleton className="h-16 w-full" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
      <Skeleton className="h-72 w-full" />
    </div>
  );
}
