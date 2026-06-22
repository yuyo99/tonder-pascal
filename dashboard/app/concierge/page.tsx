export default function ConciergePage() {
  return (
    <div className="flex h-[100dvh] flex-col items-center justify-center px-6 text-center">
      <div className="max-w-md">
        <div className="mb-6 inline-flex h-12 w-12 items-center justify-center rounded-full bg-violet-50">
          <svg
            className="h-6 w-6 text-violet-600"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
            <path d="M8 10h.01M12 10h.01M16 10h.01" />
          </svg>
        </div>
        <h1 className="text-2xl font-semibold text-gray-900">
          Pascal Concierge
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-gray-500">
          Your Tonder-native payment concierge. Conversational answers,
          proactive alerts, and one-step refunds — landing in PR2.
        </p>
      </div>
    </div>
  );
}
