export default async function ChannelPage({
  params,
}: {
  params: Promise<{ id: string; cid: string }>;
}) {
  const { id, cid } = await params;

  return (
    <div className="flex flex-col h-full">
      {/* Channel header */}
      <div className="h-12 px-4 flex items-center gap-2 border-b border-[#1a1a1d] shrink-0">
        <span className="text-zinc-500 text-lg">#</span>
        <span className="font-semibold text-zinc-100 text-sm">{cid}</span>
        <div className="w-px h-5 bg-[#3f3f46] mx-2" />
        <span className="text-xs text-zinc-500">Server {id}</span>
      </div>

      {/* Message area */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col justify-end">
        <div className="text-center py-8">
          <div className="text-4xl mb-3">#</div>
          <p className="text-lg font-bold text-zinc-200">Welcome to #{cid}!</p>
          <p className="text-sm text-zinc-500 mt-1">This is the start of the #{cid} channel.</p>
        </div>
      </div>

      {/* Message input */}
      <div className="px-4 pb-6 shrink-0">
        <div className="bg-[#27272a] rounded-lg px-4 py-3 flex items-center gap-3 text-sm text-zinc-500">
          <span>+</span>
          <span>Message #{cid}</span>
        </div>
      </div>
    </div>
  );
}
