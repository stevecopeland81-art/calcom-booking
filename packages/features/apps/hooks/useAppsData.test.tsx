import type { FormValues } from "@calcom/features/eventtypes/lib/types";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { describe, expect, it } from "vitest";
import useAppsData from "./useAppsData";

function Wrapper({ children }: { children: ReactNode }) {
  const form = useForm<FormValues>({ defaultValues: { metadata: { apps: {} } } });
  return <FormProvider {...form}>{children}</FormProvider>;
}

describe("HubSpot meeting account selection", () => {
  it("keeps the second account selected when other CRM options change", () => {
    const { result } = renderHook(() => useAppsData(), { wrapper: Wrapper });
    act(() => {
      const set = result.current.getAppDataSetter("hubspot", ["crm"], 10);
      set("credentialId", 20);
      set("enabled", true);
      set("ignoreGuests", true);
    });
    expect(result.current.getAppDataGetter("hubspot")("credentialId")).toBe(20);
    expect(result.current.getAppDataGetter("hubspot")("enabled")).toBe(true);
  });

  it("does not replace a cleared selection with the first account", () => {
    const { result } = renderHook(() => useAppsData(), { wrapper: Wrapper });
    act(() => {
      const set = result.current.getAppDataSetter("hubspot", ["crm"], 10);
      set("credentialId", 20);
      set("credentialId", undefined);
      set("enabled", true);
    });
    expect(result.current.getAppDataGetter("hubspot")("credentialId")).toBeUndefined();
  });

  it("preserves the assigned credential behavior for other apps", () => {
    const { result } = renderHook(() => useAppsData(), { wrapper: Wrapper });
    act(() => result.current.getAppDataSetter("qr_code", ["other"], 30)("enabled", true));
    expect(result.current.getAppDataGetter("qr_code")("credentialId")).toBe(30);
  });
});
