import ChannelView from '@/app/components/ChannelView';

type Props = {
  params: Promise<{ id: string; cid: string }>;
};

export default async function ChannelPage({ params }: Props) {
  const { id, cid } = await params;
  return <ChannelView serverId={id} channelId={cid} />;
}

export function generateStaticParams() {
  return [{ id: 'default', cid: 'default' }];
}
