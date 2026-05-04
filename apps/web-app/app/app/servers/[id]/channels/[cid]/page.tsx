import ChannelView from '@/app/components/ChannelView';

export default async function ChannelPage({
  params,
}: {
  params: Promise<{ id: string; cid: string }>;
}) {
  const { id, cid } = await params;
  return <ChannelView serverId={id} channelId={cid} />;
}



export function generateStaticParams() {
  return [{ id: "default", cid: "default" }];
}
