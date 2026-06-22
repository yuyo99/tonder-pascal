import PageHeader from "@/components/PageHeader";

export default function ActivityPage() {
  return (
    <>
      <PageHeader
        title="Activity"
        subtitle="Your past conversations and alerts."
      />
      <div className="rounded-2xl border border-gray-200 bg-white px-6 py-12 text-center text-sm text-gray-500">
        Conversation history and the alerts feed land here in PR2 + PR4.
      </div>
    </>
  );
}
