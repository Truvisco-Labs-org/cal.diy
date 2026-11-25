export async function redirectToHostBillingCheckout() {
  const response = await fetch("/api/host-billing/checkout", { method: "POST" });
  if (!response.ok) throw new Error("Unable to start the $1 event type checkout. Please try again.");
  const result = (await response.json()) as { url: string };
  window.location.assign(result.url);
}
