import PageHeader from "@/components/PageHeader";

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Tone, alert thresholds, channel routing, ambient opt-in."
      />
      <div className="rounded-2xl border border-gray-200 bg-white px-6 py-12 text-center text-sm text-gray-500">
        Per-merchant settings land here in PR4.
      </div>
    </>
  );
}
