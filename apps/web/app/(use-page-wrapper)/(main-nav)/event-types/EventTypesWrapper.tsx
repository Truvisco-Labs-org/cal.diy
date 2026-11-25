"use client";

import { useDebounce } from "@calcom/lib/hooks/useDebounce";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { showToast } from "@calcom/ui/components/toast";
import { ShellMainAppDir } from "app/(use-page-wrapper)/(main-nav)/ShellMainAppDir";
import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import EventTypes, { EventTypesCTA, SearchContext } from "~/event-types/views/event-types-listing-view";

type GetUserEventGroupsResponse = Parameters<typeof EventTypesCTA>[0]["userEventGroupsData"];

const CTAWithContext = ({
  userEventGroupsData,
}: {
  userEventGroupsData: GetUserEventGroupsResponse;
}): ReactElement => {
  return <EventTypesCTA userEventGroupsData={userEventGroupsData} />;
};

export function EventTypesWrapper({
  userEventGroupsData,
  user,
}: {
  userEventGroupsData: GetUserEventGroupsResponse;
  user: {
    id: number;
    completedOnboarding?: boolean;
  } | null;
}): ReactElement {
  const { t } = useLocale();
  useEffect(() => {
    const url = new URL(window.location.href);
    const billingResult = url.searchParams.get("hostBilling");
    if (billingResult === "success") showToast(t("host_billing_credit_ready"), "success");
    if (billingResult === "cancelled") showToast(t("host_billing_checkout_cancelled"), "warning");
    if (billingResult) {
      url.searchParams.delete("hostBilling");
      window.history.replaceState(null, "", url.toString());
    }
  }, [t]);
  const [searchTerm, setSearchTerm] = useState("");
  const debouncedSearchTerm = useDebounce(searchTerm, 500);

  return (
    <SearchContext.Provider value={{ searchTerm, setSearchTerm, debouncedSearchTerm }}>
      <ShellMainAppDir
        heading={t("event_types_page_title")}
        subtitle={t("event_types_page_subtitle")}
        CTA={<CTAWithContext userEventGroupsData={userEventGroupsData} />}>
        <EventTypes userEventGroupsData={userEventGroupsData} user={user} />
      </ShellMainAppDir>
    </SearchContext.Provider>
  );
}
