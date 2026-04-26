export default async function ServerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="flex flex-1 items-center justify-center h-full text-zinc-500">
      <div className="text-center">
        <div className="text-5xl mb-4">🗂️</div>
        <p className="text-lg font-medium text-zinc-400">Server <span className="text-zinc-300 font-semibold">{id}</span></p>
        <p className="text-sm mt-1">Select a channel from the sidebar</p>
      </div>
    </div>
  );
}
